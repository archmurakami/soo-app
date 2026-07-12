import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";

type ComprovanteInput = {
  filename: string;
  mime_type: string;
  data_base64: string;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

const ComprovanteSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  data_base64: z.string().min(1)
});

// Ephemeral per-isolate limiter for the attachment proof. Use Cloudflare WAF/Rate Limiting in production too.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok" }, 200, request);
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "not_found" }, 404, request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const originError = validateOrigin(request);
    if (originError) return originError;

    const rateError = rateLimit(request);
    if (rateError) return rateError;

    const server = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    await server.close();
    return withCors(response, request);
  }
};

function createServer() {
  const server = new McpServer({
    name: "soo-mcp",
    version: "0.3.0"
  });

  server.registerTool(
    "testar_recebimento_comprovante",
    {
      title: "Testar recebimento de comprovante",
      description: [
        "Prova temporária para verificar se um comprovante chega ao servidor MCP.",
        "O MCP define argumentos de ferramenta como JSON; não há garantia de que anexos do ChatGPT sejam encaminhados automaticamente.",
        "Para teste manual/protocolar, envie comprovante.filename, comprovante.mime_type e comprovante.data_base64."
      ].join(" "),
      inputSchema: {
        comprovante: ComprovanteSchema.optional()
      }
    },
    async ({ comprovante }) => testarRecebimentoComprovante(comprovante)
  );

  return server;
}

async function testarRecebimentoComprovante(comprovante?: ComprovanteInput) {
  if (!comprovante) {
    return toolJson({
      recebido: false,
      filename: null,
      mime_type: null,
      tamanho_bytes: 0,
      sha256: null,
      limitacao: "Nenhum comprovante chegou nos argumentos da ferramenta. O MCP usa JSON Schema para argumentos; anexo do ChatGPT não é automaticamente convertido em data_base64 por garantia do protocolo."
    });
  }

  validateComprovante(comprovante);
  const bytes = base64ToBytes(comprovante.data_base64);
  const hash = await sha256(bytes);

  return toolJson({
    recebido: true,
    filename: comprovante.filename,
    mime_type: comprovante.mime_type,
    tamanho_bytes: bytes.byteLength,
    sha256: hash
  });
}

function validateComprovante(comprovante: ComprovanteInput) {
  const expectedExt = extensionFor(comprovante);
  const ext = comprovante.filename.split(".").pop()?.toLowerCase();
  if (!ext || (expectedExt === "jpg" ? !["jpg", "jpeg"].includes(ext) : ext !== expectedExt)) {
    throw new Error("Extensão do comprovante não corresponde ao MIME type.");
  }

  const size = base64Size(comprovante.data_base64);
  if (size > MAX_FILE_BYTES) {
    throw new Error("Comprovante excede o limite de 10 MB.");
  }
}

function extensionFor(comprovante: ComprovanteInput) {
  const ext = MIME_TO_EXT[comprovante.mime_type];
  if (!ext) throw new Error("Tipo de comprovante não permitido.");
  return ext;
}

function base64ToBytes(value: string) {
  const normalized = normalizeBase64(value);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Size(value: string) {
  const normalized = normalizeBase64(value);
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function normalizeBase64(value: string) {
  return value.includes(",") ? value.split(",").pop() || "" : value;
}

async function sha256(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || isAllowedOrigin(origin)) return null;
  return json({ error: "origin_not_allowed" }, 403, request);
}

function rateLimit(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    return json({ error: "rate_limited" }, 429, request);
  }
  return null;
}

function toolJson(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text" as const, text }]
  };
}

function json(body: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request) }
  });
}

function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function corsHeaders(request?: Request) {
  const origin = request?.headers.get("origin") || "";
  const allowOrigin = isAllowedOrigin(origin) ? origin : "https://chatgpt.com";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
    "vary": "Origin"
  };
}

function isAllowedOrigin(origin: string) {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com") || hostname.endsWith(".openai.com");
  } catch {
    return false;
  }
}

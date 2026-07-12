type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SOO_MCP_API_TOKEN: string;
  SOO_OWNER_ID: string;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ComprovanteInput = {
  filename: string;
  mime_type: string;
  data_base64: string;
};

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const CATEGORIES = [
  "A classificar",
  "Obra Civil / Azulejista",
  "Demolição",
  "Hidráulica",
  "Elétrica",
  "Pintura",
  "Gesso",
  "Piso / Vinílico",
  "Proteção de Piso",
  "Marcenaria",
  "Serralheria",
  "Vidro",
  "Porta",
  "Comunicação Visual",
  "Ar-condicionado",
  "Limpeza",
  "Caçamba",
  "Outros"
];

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

// Ephemeral per-isolate limiter. Production hard limits should use Cloudflare WAF/Rate Limiting too.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "not_found" }, 404);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const authError = await authorize(request, env);
    if (authError) return authError;

    const rateError = rateLimit(request);
    if (rateError) return rateError;

    if (request.method === "GET") {
      return json({ error: "sse_stream_not_enabled" }, 405);
    }

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    let rpc: JsonRpcRequest;
    try {
      rpc = await request.json();
    } catch {
      return rpcError(null, -32700, "Parse error");
    }

    return handleRpc(rpc, env);
  }
};

async function handleRpc(rpc: JsonRpcRequest, env: Env): Promise<Response> {
  const id = rpc.id ?? null;

  try {
    if (rpc.method === "initialize") {
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "soo-mcp", version: "0.1.0" }
      });
    }

    if (rpc.method === "notifications/initialized") {
      return new Response(null, { status: 202, headers: corsHeaders() });
    }

    if (rpc.method === "ping") {
      return rpcResult(id, {});
    }

    if (rpc.method === "tools/list") {
      return rpcResult(id, { tools: toolDefinitions() });
    }

    if (rpc.method === "tools/call") {
      const name = stringParam(rpc.params, "name");
      const args = objectParam(rpc.params, "arguments", {});
      const result = await callTool(name, args, env);
      return rpcResult(id, result);
    }

    return rpcError(id, -32601, "Method not found");
  } catch (error) {
    return rpcError(id, -32000, safeError(error));
  }
}

async function callTool(name: string, args: Record<string, unknown>, env: Env): Promise<ToolResult> {
  if (name === "listar_obras") {
    const obras = await supabaseGet(env, `/rest/v1/obras?owner_id=eq.${env.SOO_OWNER_ID}&select=id,nome,cliente,cidade,status&order=created_at.desc`);
    return toolJson(obras);
  }

  if (name === "buscar_contatos") {
    const termo = stringArg(args, "termo").trim();
    const query = encodeURIComponent(`%${escapeLike(termo)}%`);
    const contatos = await supabaseGet(
      env,
      `/rest/v1/contatos?owner_id=eq.${env.SOO_OWNER_ID}&or=(nome.ilike.${query},cpf_cnpj.ilike.${query},telefone.ilike.${query})&select=id,nome,tipos,cpf_cnpj,telefone&order=nome.asc&limit=20`
    );
    return toolJson(contatos);
  }

  if (name === "listar_categorias") {
    return toolJson(CATEGORIES);
  }

  if (name === "criar_despesa_com_comprovante") {
    return criarDespesaComComprovante(args, env);
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }]
  };
}

async function criarDespesaComComprovante(args: Record<string, unknown>, env: Env): Promise<ToolResult> {
  const avisos: string[] = [];
  const confirmacao = booleanArg(args, "confirmacao_usuario");
  if (!confirmacao) {
    return toolError("Confirmação do usuário é obrigatória antes de registrar a despesa.");
  }

  const obraId = uuidArg(args, "obra_id");
  const descricao = stringArg(args, "descricao").trim();
  const valor = numberArg(args, "valor");
  const data = dateArg(args, "data");
  const contatoId = optionalUuidArg(args, "contato_id");
  const contatoNome = optionalStringArg(args, "contato_nome");
  const quemPagou = stringArg(args, "quem_pagou").trim();
  const categoria = stringArg(args, "categoria").trim();
  const observacao = optionalStringArg(args, "observacao");
  const comprovante = comprovanteArg(args, "comprovante");
  const idempotencyKey = await idempotencyKeyFor(args);

  const obra = await getOwnedObra(env, obraId);
  if (!obra) return toolError("Obra não encontrada para o administrador configurado.");

  if (contatoId) {
    const contato = await getOwnedContato(env, contatoId);
    if (!contato) return toolError("Contato não encontrado para o administrador configurado.");
  }

  const duplicate = await findDuplicate(env, idempotencyKey);
  if (duplicate) {
    return toolJson({
      sucesso: true,
      idempotente: true,
      despesa_id: duplicate.id,
      obra,
      descrição: duplicate.descricao,
      valor: Number(duplicate.valor),
      data: duplicate.data,
      categoria: duplicate.categoria,
      comprovante_path: duplicate.comprovante_path,
      avisos: ["Solicitação já registrada anteriormente; nenhum novo registro foi criado."]
    });
  }

  validateComprovante(comprovante);
  const extension = extensionFor(comprovante);
  const now = new Date();
  const storagePath = `${env.SOO_OWNER_ID}/${obraId}/${now.getUTCFullYear()}/${pad2(now.getUTCMonth() + 1)}/${crypto.randomUUID()}.${extension}`;

  let uploaded = false;
  try {
    await uploadStorage(env, storagePath, comprovante);
    uploaded = true;

    let finalObservacao = observacao?.trim() || "";
    if (contatoNome && !contatoId) {
      avisos.push("contato_nome foi informado sem contato_id; nenhum contato foi criado automaticamente.");
      finalObservacao = joinObservation(finalObservacao, `Contato informado pelo ChatGPT: ${contatoNome}`);
    }
    finalObservacao = joinObservation(finalObservacao, `[soo_mcp_idempotency_key:${idempotencyKey}]`);

    const despesa = await supabasePost(env, "/rest/v1/despesas", {
      owner_id: env.SOO_OWNER_ID,
      obra_id: obraId,
      contato_id: contatoId,
      descricao,
      valor,
      data,
      quem_pagou: quemPagou,
      categoria,
      observacao: finalObservacao || null,
      comprovante_path: storagePath,
      status_classificacao: categoria === "A classificar" ? "a_classificar" : "classificada"
    });

    return toolJson({
      sucesso: true,
      despesa_id: despesa.id,
      obra,
      descrição: despesa.descricao,
      valor: Number(despesa.valor),
      data: despesa.data,
      categoria: despesa.categoria,
      comprovante_path: despesa.comprovante_path,
      avisos
    });
  } catch (error) {
    if (uploaded) {
      await deleteStorage(env, storagePath).catch(() => undefined);
    }
    throw error;
  }
}

function toolDefinitions() {
  return [
    {
      name: "listar_obras",
      description: "Lista obras do administrador SOO configurado.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "buscar_contatos",
      description: "Busca contatos do administrador SOO por nome, CPF/CNPJ ou telefone.",
      inputSchema: {
        type: "object",
        properties: { termo: { type: "string" } },
        required: ["termo"],
        additionalProperties: false
      }
    },
    {
      name: "listar_categorias",
      description: "Lista categorias iniciais de despesas do SOO.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "criar_despesa_com_comprovante",
      description: "Cria despesa confirmada pelo usuário e envia o comprovante ao Supabase Storage.",
      inputSchema: {
        type: "object",
        properties: {
          obra_id: { type: "string", format: "uuid" },
          descricao: { type: "string" },
          valor: { type: "number" },
          data: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          contato_id: { type: "string", format: "uuid" },
          contato_nome: { type: "string" },
          quem_pagou: { type: "string" },
          categoria: { type: "string" },
          observacao: { type: "string" },
          idempotency_key: { type: "string" },
          confirmacao_usuario: { type: "boolean" },
          comprovante: {
            type: "object",
            properties: {
              filename: { type: "string" },
              mime_type: { type: "string", enum: Object.keys(MIME_TO_EXT) },
              data_base64: { type: "string" }
            },
            required: ["filename", "mime_type", "data_base64"],
            additionalProperties: false
          }
        },
        required: ["obra_id", "descricao", "valor", "data", "quem_pagou", "categoria", "comprovante", "confirmacao_usuario"],
        additionalProperties: false
      }
    }
  ];
}

async function getOwnedObra(env: Env, obraId: string) {
  const rows = await supabaseGet(env, `/rest/v1/obras?id=eq.${obraId}&owner_id=eq.${env.SOO_OWNER_ID}&select=id,nome,cliente,cidade,status&limit=1`);
  return rows[0] ?? null;
}

async function getOwnedContato(env: Env, contatoId: string) {
  const rows = await supabaseGet(env, `/rest/v1/contatos?id=eq.${contatoId}&owner_id=eq.${env.SOO_OWNER_ID}&select=id&limit=1`);
  return rows[0] ?? null;
}

async function findDuplicate(env: Env, idempotencyKey: string) {
  const marker = encodeURIComponent(`%[soo_mcp_idempotency_key:${escapeLike(idempotencyKey)}]%`);
  const rows = await supabaseGet(
    env,
    `/rest/v1/despesas?owner_id=eq.${env.SOO_OWNER_ID}&observacao=ilike.${marker}&select=id,descricao,valor,data,categoria,comprovante_path&limit=1`
  );
  return rows[0] ?? null;
}

async function supabaseGet(env: Env, path: string) {
  const response = await supabaseFetch(env, path, { method: "GET" });
  return response.json();
}

async function supabasePost(env: Env, path: string, body: Record<string, unknown>) {
  const response = await supabaseFetch(env, path, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  const rows = await response.json();
  return rows[0];
}

async function supabaseFetch(env: Env, path: string, init: RequestInit & { headers?: Record<string, string> }) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase retornou ${response.status}`);
  }
  return response;
}

async function uploadStorage(env: Env, path: string, comprovante: ComprovanteInput) {
  const bytes = base64ToBytes(comprovante.data_base64);
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/comprovantes/${path}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": comprovante.mime_type,
      "x-upsert": "false"
    },
    body: bytes
  });
  if (!response.ok) throw new Error(`Falha ao enviar comprovante (${response.status})`);
}

async function deleteStorage(env: Env, path: string) {
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/comprovantes`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ prefixes: [path] })
  });
  if (!response.ok) throw new Error(`Falha ao remover comprovante (${response.status})`);
}

async function authorize(request: Request, env: Env) {
  const value = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.SOO_MCP_API_TOKEN}`;
  if (!(await timingSafeEqual(value, expected))) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

async function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  const leftHash = new Uint8Array(await crypto.subtle.digest("SHA-256", left));
  const rightHash = new Uint8Array(await crypto.subtle.digest("SHA-256", right));
  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }
  return diff === 0;
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
    return json({ error: "rate_limited" }, 429);
  }
  return null;
}

function validateComprovante(comprovante: ComprovanteInput) {
  const expectedExt = extensionFor(comprovante);
  const ext = comprovante.filename.split(".").pop()?.toLowerCase();
  if (!ext || (expectedExt === "jpg" ? !["jpg", "jpeg"].includes(ext) : ext !== expectedExt)) {
    throw new Error("Extensão do comprovante não corresponde ao MIME type.");
  }
  const size = base64Size(comprovante.data_base64);
  if (size > MAX_FILE_BYTES) throw new Error("Comprovante excede o limite de 10 MB.");
}

function extensionFor(comprovante: ComprovanteInput) {
  const ext = MIME_TO_EXT[comprovante.mime_type];
  if (!ext) throw new Error("Tipo de comprovante não permitido.");
  return ext;
}

function comprovanteArg(args: Record<string, unknown>, key: string): ComprovanteInput {
  const value = objectParam(args, key);
  return {
    filename: stringArg(value, "filename"),
    mime_type: stringArg(value, "mime_type"),
    data_base64: stringArg(value, "data_base64")
  };
}

async function idempotencyKeyFor(args: Record<string, unknown>) {
  const provided = optionalStringArg(args, "idempotency_key");
  if (provided) return provided.slice(0, 120);
  const material = JSON.stringify({
    obra_id: args.obra_id,
    descricao: args.descricao,
    valor: args.valor,
    data: args.data,
    comprovante: objectParam(args, "comprovante").data_base64
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string) {
  const normalized = value.includes(",") ? value.split(",").pop() || "" : value;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Size(value: string) {
  const normalized = value.includes(",") ? value.split(",").pop() || "" : value;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function stringParam(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  if (typeof value !== "string") throw new Error(`Parâmetro obrigatório inválido: ${key}`);
  return value;
}

function objectParam(source: Record<string, unknown> | undefined, key: string, fallback?: Record<string, unknown>) {
  const value = source?.[key] ?? fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Parâmetro obrigatório inválido: ${key}`);
  return value as Record<string, unknown>;
}

function stringArg(source: Record<string, unknown>, key: string) {
  return stringParam(source, key);
}

function optionalStringArg(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`Parâmetro inválido: ${key}`);
  return value;
}

function uuidArg(source: Record<string, unknown>, key: string) {
  const value = stringArg(source, key);
  if (!isUuid(value)) throw new Error(`UUID inválido: ${key}`);
  return value;
}

function optionalUuidArg(source: Record<string, unknown>, key: string) {
  const value = optionalStringArg(source, key);
  if (!value) return null;
  if (!isUuid(value)) throw new Error(`UUID inválido: ${key}`);
  return value;
}

function numberArg(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Número inválido: ${key}`);
  return value;
}

function booleanArg(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (typeof value !== "boolean") throw new Error(`Booleano obrigatório inválido: ${key}`);
  return value;
}

function dateArg(source: Record<string, unknown>, key: string) {
  const value = stringArg(source, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Data inválida: ${key}`);
  return value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_").replaceAll("*", "");
}

function joinObservation(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join("\n");
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toolJson(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}

function corsHeaders(request?: Request) {
  const origin = request?.headers.get("origin") || "";
  const allowOrigin = origin.endsWith(".openai.com") || origin.endsWith(".chatgpt.com") ? origin : "https://chatgpt.com";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version",
    "vary": "Origin"
  };
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "Erro interno";
}

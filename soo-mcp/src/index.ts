import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import * as z from "zod/v4";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
};

type AuthContext = {
  accessToken: string;
  userId: string;
};

type AuthResult =
  | { ok: true; context: AuthContext; diagnostics: AuthDiagnostics }
  | { ok: false; diagnostics: AuthDiagnostics };

type AuthDiagnostics = {
  authorization_header: "present" | "missing";
  jwt_validation: "not_checked" | "valid" | "missing_bearer" | "invalid";
  jwt_error?: string;
  sub?: string;
};

type RequestDiagnostics = {
  timestamp: string;
  tool_name: string | null;
  authorization_header: "present" | "missing";
  jwt_validation: AuthDiagnostics["jwt_validation"];
  jwt_error?: string;
  sub?: string;
  final_status: number;
};

type OpenAIFileInput = {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
};

type DownloadedComprovante = {
  bytes: Uint8Array;
  filename: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  size: number;
};

type DespesaArgs = {
  obra_id: string;
  descricao: string;
  valor: number;
  data: string;
  contato_id?: string;
  contato_nome?: string;
  quem_pagou: string;
  categoria: string;
  observacao?: string;
  confirmacao_usuario: boolean;
  idempotency_key: string;
};

type FileUploadDiagnostics = {
  tool: "criar_despesa_com_comprovante";
  file_metadata_received: boolean;
  file_name?: string;
  mime_type?: string;
  informed_size?: number;
  downloaded_size?: number;
  upload_status?: "completed" | "failed" | "not_started";
  comprovante_path?: string;
  final_status: "success" | "error";
};

const RESOURCE_URL = "https://soo-mcp.rymurakami.workers.dev";
const AUTH_SERVER = "https://nlfzjmruzmstrysuohxl.supabase.co/auth/v1";
const OAUTH_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIN_FILE_BYTES = 256;
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
const MIME_TO_EXT: Record<DownloadedComprovante["mime_type"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf"
};
const OAUTH_META = {
  securitySchemes: [
    {
      type: "oauth2",
      scopes: ["openid", "email", "profile"],
      flows: {
        authorizationCode: {
          authorizationUrl: `${AUTH_SERVER}/authorize`,
          tokenUrl: `${AUTH_SERVER}/token`,
          scopes: {
            openid: "Identificar o usuário autenticado",
            email: "Acessar o e-mail do usuário",
            profile: "Acessar o perfil básico do usuário"
          }
        }
      }
    }
  ]
};
const OPENAI_TOOL_SECURITY_META = {
  ...OAUTH_META,
  "openai/toolInvocation/invoking": "Processando no SOO...",
  "openai/toolInvocation/invoked": "SOO atualizado"
};
const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false
};
const CREATE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
const UPDATE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

const DespesaInputSchema = {
  obra_id: z.string().uuid(),
  descricao: z.string().min(1),
  valor: z.number().nonnegative(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contato_id: z.string().uuid().optional(),
  contato_nome: z.string().optional(),
  quem_pagou: z.string().min(1),
  categoria: z.string().min(1),
  observacao: z.string().optional(),
  confirmacao_usuario: z.boolean(),
  idempotency_key: z.string().min(8).max(160)
};
const OpenAIFileSchema = z.strictObject({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional()
});

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok" }, 200, request);
    }

    if (url.pathname === OAUTH_RESOURCE_METADATA_PATH) {
      return json(oauthProtectedResourceMetadata(), 200, request);
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "not_found" }, 404, request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const toolName = await readMcpToolName(request);
    const preAuthDiagnostics = getPreAuthDiagnostics(request);
    const originError = validateOrigin(request);
    if (originError) {
      logMcpDiagnostics(toolName, preAuthDiagnostics, originError.status);
      return originError;
    }

    const rateError = rateLimit(request);
    if (rateError) {
      logMcpDiagnostics(toolName, preAuthDiagnostics, rateError.status);
      return rateError;
    }

    const auth = await authenticate(request, env);
    if (!auth.ok) {
      const response = unauthorized(request);
      logMcpDiagnostics(toolName, auth.diagnostics, response.status);
      return response;
    }

    const server = createServer(env, auth.context);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request, {
        authInfo: { token: auth.context.accessToken, clientId: auth.context.userId, scopes: ["openid", "email", "profile"] }
      });
      const decoratedResponse = await withOpenAiToolDescriptors(response, toolName);
      const finalResponse = withCors(decoratedResponse, request);
      logMcpDiagnostics(toolName, auth.diagnostics, finalResponse.status);
      return finalResponse;
    } catch (error) {
      logMcpDiagnostics(toolName, auth.diagnostics, 500, error);
      throw error;
    } finally {
      await server.close();
    }
  }
};

export function createServer(env: Env, auth: AuthContext) {
  const server = new McpServer({ name: "soo-mcp", version: "1.1.0" });

  server.registerTool(
    "listar_obras",
    {
      title: "Listar obras",
      description: "Lista obras do usuário autenticado no SOO.",
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: OPENAI_TOOL_SECURITY_META
    },
    async () => {
      const obras = await supabaseGet(
        env,
        auth,
        `/rest/v1/obras?owner_id=eq.${encodeURIComponent(auth.userId)}&select=id,nome,cliente,cidade,status,data_inicio&order=created_at.desc`
      );
      return toolJson(obras);
    }
  );

  server.registerTool(
    "buscar_contatos",
    {
      title: "Buscar contatos",
      description: "Busca contatos do usuário autenticado por nome, CPF/CNPJ ou telefone.",
      inputSchema: { termo: z.string().min(1) },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: OPENAI_TOOL_SECURITY_META
    },
    async ({ termo }) => {
      const query = encodeURIComponent(`%${escapeLike(termo.trim())}%`);
      const contatos = await supabaseGet(
        env,
        auth,
        `/rest/v1/contatos?owner_id=eq.${encodeURIComponent(auth.userId)}&or=(nome.ilike.${query},cpf_cnpj.ilike.${query},telefone.ilike.${query})&select=id,nome,tipos,cpf_cnpj,telefone,pix&order=nome.asc&limit=20`
      );
      return toolJson(contatos);
    }
  );

  server.registerTool(
    "listar_categorias",
    {
      title: "Listar categorias",
      description: "Lista categorias de despesas do SOO.",
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: OPENAI_TOOL_SECURITY_META
    },
    async () => toolJson(CATEGORIES)
  );

  server.registerTool(
    "criar_despesa",
    {
      title: "Criar despesa",
      description: "Cria despesa confirmada pelo usuário autenticado sem anexar comprovante.",
      inputSchema: DespesaInputSchema,
      annotations: CREATE_ANNOTATIONS,
      _meta: OPENAI_TOOL_SECURITY_META
    },
    async (args) => criarDespesa(env, auth, args)
  );

  server.registerTool(
    "criar_despesa_com_comprovante",
    {
      title: "Criar despesa com comprovante",
      description: "Cria despesa confirmada pelo usuário autenticado e envia comprovante ao Supabase Storage.",
      inputSchema: {
        ...DespesaInputSchema,
        comprovante: OpenAIFileSchema
      },
      annotations: CREATE_ANNOTATIONS,
      _meta: {
        ...OPENAI_TOOL_SECURITY_META,
        "openai/fileParams": ["comprovante"]
      }
    },
    async (args) => criarDespesaComComprovante(env, auth, args)
  );

  server.registerTool(
    "atualizar_despesa",
    {
      title: "Atualizar despesa",
      description: "Atualiza campos editáveis de uma despesa do usuário autenticado.",
      inputSchema: {
        despesa_id: z.string().uuid(),
        descricao: z.string().min(1).optional(),
        valor: z.number().nonnegative().optional(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        contato_id: z.string().uuid().nullable().optional(),
        quem_pagou: z.string().min(1).optional(),
        categoria: z.string().min(1).optional(),
        observacao: z.string().nullable().optional(),
        confirmacao_usuario: z.boolean()
      },
      annotations: UPDATE_ANNOTATIONS,
      _meta: OPENAI_TOOL_SECURITY_META
    },
    async (args) => atualizarDespesa(env, auth, args)
  );

  return server;
}

async function criarDespesa(env: Env, auth: AuthContext, args: DespesaArgs) {
  return criarDespesaBase(env, auth, args, null);
}

async function criarDespesaComComprovante(env: Env, auth: AuthContext, args: DespesaArgs & { comprovante: OpenAIFileInput }) {
  const diagnostics: FileUploadDiagnostics = {
    tool: "criar_despesa_com_comprovante",
    file_metadata_received: Boolean(args.comprovante?.download_url && args.comprovante?.file_id),
    file_name: args.comprovante?.file_name,
    mime_type: args.comprovante?.mime_type,
    upload_status: "not_started",
    final_status: "error"
  };

  try {
    const comprovante = await downloadComprovante(args.comprovante, diagnostics);
    const result = await criarDespesaBase(env, auth, args, comprovante, diagnostics);
    diagnostics.final_status = "isError" in result && result.isError ? "error" : "success";
    return result;
  } catch (error) {
    diagnostics.final_status = "error";
    logFileUploadDiagnostics(diagnostics);
    return toolError(error instanceof Error ? error.message : "Falha ao processar comprovante.");
  }
}

async function criarDespesaBase(
  env: Env,
  auth: AuthContext,
  args: DespesaArgs,
  comprovante: DownloadedComprovante | null,
  diagnostics?: FileUploadDiagnostics
) {
  const avisos: string[] = [];
  if (args.confirmacao_usuario !== true) return toolError("Confirmação do usuário é obrigatória antes de registrar a despesa.");

  const duplicate = await findDespesaByIdempotency(env, auth, args.idempotency_key);
  if (duplicate) return despesaCriadaResult(duplicate, duplicate.obras ?? null, duplicate.contatos ?? null, true, avisos);

  const obra = await getOwnedObra(env, auth, args.obra_id);
  if (!obra) return toolError("Obra não encontrada para o usuário autenticado.");

  let contato = null;
  if (args.contato_id) {
    contato = await getOwnedContato(env, auth, args.contato_id);
    if (!contato) return toolError("Contato não encontrado para o usuário autenticado.");
  }

  const storagePath = comprovante ? storagePathFor(auth, args.obra_id, comprovante) : null;
  if (diagnostics && storagePath) diagnostics.comprovante_path = storagePath;

  if (args.contato_nome && !args.contato_id) {
    avisos.push("contato_nome foi informado sem contato_id; nenhum contato foi criado automaticamente.");
  }

  let uploaded = false;
  try {
    if (comprovante && storagePath) {
      await uploadStorage(env, auth, storagePath, comprovante);
      uploaded = true;
      const exists = await storageObjectExists(env, auth, storagePath);
      if (!exists) throw new Error("Upload do comprovante não foi confirmado no Storage.");
      diagnostics!.upload_status = "completed";
    }

    const observacao = args.contato_nome && !args.contato_id
      ? joinObservation(args.observacao, `Contato informado pelo ChatGPT: ${args.contato_nome}`)
      : args.observacao?.trim() || null;

    const inserted = await supabasePost(env, auth, "/rest/v1/despesas", {
      owner_id: auth.userId,
      obra_id: args.obra_id,
      contato_id: args.contato_id ?? null,
      descricao: args.descricao.trim(),
      valor: args.valor,
      data: args.data,
      quem_pagou: args.quem_pagou.trim(),
      categoria: args.categoria.trim(),
      observacao,
      comprovante_path: storagePath,
      status_classificacao: args.categoria === "A classificar" ? "a_classificar" : "classificada",
      idempotency_key: args.idempotency_key,
      origem: "chatgpt"
    });

    const result = despesaCriadaResult(inserted, obra, contato, false, avisos);
    if (diagnostics) {
      diagnostics.final_status = "success";
      logFileUploadDiagnostics(diagnostics);
    }
    return result;
  } catch (error) {
    if (diagnostics) diagnostics.upload_status = uploaded ? "completed" : "failed";
    const existing = await findDespesaByIdempotency(env, auth, args.idempotency_key).catch(() => null);
    if (existing) {
      if (uploaded && storagePath) await deleteStorage(env, auth, storagePath).catch(() => undefined);
      const result = despesaCriadaResult(existing, existing.obras ?? obra, existing.contatos ?? contato, true, avisos);
      if (diagnostics) {
        diagnostics.final_status = "success";
        logFileUploadDiagnostics(diagnostics);
      }
      return result;
    }
    if (uploaded && storagePath) await deleteStorage(env, auth, storagePath).catch(() => undefined);
    if (diagnostics) {
      diagnostics.final_status = "error";
      logFileUploadDiagnostics(diagnostics);
    }
    throw error;
  }
}

async function atualizarDespesa(
  env: Env,
  auth: AuthContext,
  args: {
    despesa_id: string;
    descricao?: string;
    valor?: number;
    data?: string;
    contato_id?: string | null;
    quem_pagou?: string;
    categoria?: string;
    observacao?: string | null;
    confirmacao_usuario: boolean;
  }
) {
  if (args.confirmacao_usuario !== true) return toolError("Confirmação do usuário é obrigatória antes de alterar a despesa.");

  const current = await getOwnedDespesa(env, auth, args.despesa_id);
  if (!current) return toolError("Despesa não encontrada para o usuário autenticado.");

  if (args.contato_id) {
    const contato = await getOwnedContato(env, auth, args.contato_id);
    if (!contato) return toolError("Contato não encontrado para o usuário autenticado.");
  }

  const updates: Record<string, unknown> = {};
  for (const key of ["descricao", "valor", "data", "contato_id", "quem_pagou", "categoria", "observacao"] as const) {
    if (Object.prototype.hasOwnProperty.call(args, key)) updates[key] = args[key];
  }
  if (args.categoria) updates.status_classificacao = args.categoria === "A classificar" ? "a_classificar" : "classificada";
  if (!Object.keys(updates).length) return toolError("Nenhum campo editável foi enviado.");

  const updated = await supabasePatch(
    env,
    auth,
    `/rest/v1/despesas?id=eq.${args.despesa_id}&owner_id=eq.${encodeURIComponent(auth.userId)}`,
    updates
  );

  return toolJson({ sucesso: true, despesa: updated });
}

function despesaCriadaResult(despesa: Record<string, any>, obra: unknown, contato: unknown, idempotente: boolean, avisos: string[]) {
  return toolJson({
    sucesso: true,
    idempotente,
    despesa_id: despesa.id,
    obra,
    descricao: despesa.descricao,
    valor: Number(despesa.valor),
    data: despesa.data,
    contato,
    categoria: despesa.categoria,
    comprovante_path: despesa.comprovante_path,
    avisos
  });
}

async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const authorization = request.headers.get("authorization") || "";
  const diagnostics: AuthDiagnostics = {
    authorization_header: authorization ? "present" : "missing",
    jwt_validation: "not_checked"
  };
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, diagnostics: { ...diagnostics, jwt_validation: authorization ? "missing_bearer" : "not_checked" } };

  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const jwks = getJwks(`${issuer}/.well-known/jwks.json`);
  try {
    const { payload } = await jwtVerify(match[1], jwks, { issuer });
    if (!payload.sub) return { ok: false, diagnostics: { ...diagnostics, jwt_validation: "invalid", jwt_error: "missing_sub" } };
    return {
      ok: true,
      context: { accessToken: match[1], userId: payload.sub },
      diagnostics: { ...diagnostics, jwt_validation: "valid", sub: payload.sub }
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: {
        ...diagnostics,
        jwt_validation: "invalid",
        jwt_error: safeJwtError(error)
      }
    };
  }
}

function getJwks(url: string) {
  let jwks = jwksByIssuer.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksByIssuer.set(url, jwks);
  }
  return jwks;
}

function unauthorized(request: Request) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": `Bearer resource_metadata="${RESOURCE_URL}${OAUTH_RESOURCE_METADATA_PATH}"`,
    ...corsHeaders(request)
  });
  return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
}

function getPreAuthDiagnostics(request: Request): AuthDiagnostics {
  return {
    authorization_header: request.headers.get("authorization") ? "present" : "missing",
    jwt_validation: "not_checked"
  };
}

async function readMcpToolName(request: Request) {
  if (request.method !== "POST") return null;
  try {
    const payload = await request.clone().json() as unknown;
    return extractToolName(payload);
  } catch {
    return null;
  }
}

function extractToolName(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const name = extractToolName(item);
      if (name) return name;
    }
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.method !== "tools/call") return typeof record.method === "string" ? record.method : null;
  const params = record.params;
  if (!params || typeof params !== "object") return "tools/call";
  const name = (params as Record<string, unknown>).name;
  return typeof name === "string" ? name : "tools/call";
}

function logMcpDiagnostics(toolName: string | null, auth: AuthDiagnostics, finalStatus: number, error?: unknown) {
  const entry: RequestDiagnostics = {
    timestamp: new Date().toISOString(),
    tool_name: toolName,
    authorization_header: auth.authorization_header,
    jwt_validation: auth.jwt_validation,
    final_status: finalStatus
  };
  if (auth.jwt_error) entry.jwt_error = auth.jwt_error;
  if (auth.sub) entry.sub = auth.sub;
  if (error) entry.jwt_error = `worker_error:${safeJwtError(error)}`;
  console.log(JSON.stringify({ event: "soo_mcp_call", ...entry }));
}

function safeJwtError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; name?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    if (typeof candidate.name === "string") return candidate.name;
  }
  return "unknown";
}

function oauthProtectedResourceMetadata() {
  return {
    resource: RESOURCE_URL,
    authorization_servers: [AUTH_SERVER],
    scopes_supported: ["openid", "email", "profile"]
  };
}

async function supabaseGet(env: Env, auth: AuthContext, path: string) {
  const response = await supabaseFetch(env, auth, path, { method: "GET" });
  return response.json() as Promise<Array<Record<string, any>>>;
}

async function supabasePost(env: Env, auth: AuthContext, path: string, body: Record<string, unknown>) {
  const response = await supabaseFetch(env, auth, path, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  const rows = await response.json() as Array<Record<string, any>>;
  return rows[0];
}

async function supabasePatch(env: Env, auth: AuthContext, path: string, body: Record<string, unknown>) {
  const response = await supabaseFetch(env, auth, path, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  const rows = await response.json() as Array<Record<string, any>>;
  return rows[0] ?? null;
}

async function supabaseFetch(env: Env, auth: AuthContext, path: string, init: RequestInit & { headers?: Record<string, string> }) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${auth.accessToken}`,
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Supabase retornou ${response.status}`);
  return response;
}

async function getOwnedObra(env: Env, auth: AuthContext, obraId: string) {
  const rows = await supabaseGet(
    env,
    auth,
    `/rest/v1/obras?id=eq.${obraId}&owner_id=eq.${encodeURIComponent(auth.userId)}&select=id,nome,cliente,cidade,status,data_inicio&limit=1`
  );
  return rows[0] ?? null;
}

async function getOwnedContato(env: Env, auth: AuthContext, contatoId: string) {
  const rows = await supabaseGet(
    env,
    auth,
    `/rest/v1/contatos?id=eq.${contatoId}&owner_id=eq.${encodeURIComponent(auth.userId)}&select=id,nome,tipos,cpf_cnpj,telefone,pix&limit=1`
  );
  return rows[0] ?? null;
}

async function getOwnedDespesa(env: Env, auth: AuthContext, despesaId: string) {
  const rows = await supabaseGet(
    env,
    auth,
    `/rest/v1/despesas?id=eq.${despesaId}&owner_id=eq.${encodeURIComponent(auth.userId)}&select=id,obra_id,owner_id&limit=1`
  );
  return rows[0] ?? null;
}

async function findDespesaByIdempotency(env: Env, auth: AuthContext, idempotencyKey: string) {
  const rows = await supabaseGet(
    env,
    auth,
    `/rest/v1/despesas?owner_id=eq.${encodeURIComponent(auth.userId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*,obras(id,nome,cliente,cidade,status,data_inicio),contatos(id,nome,tipos,cpf_cnpj,telefone,pix)&limit=1`
  );
  return rows[0] ?? null;
}

async function uploadStorage(env: Env, auth: AuthContext, path: string, comprovante: DownloadedComprovante) {
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/comprovantes/${path}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": comprovante.mime_type,
      "x-upsert": "false"
    },
    body: new Blob([comprovante.bytes.slice().buffer as ArrayBuffer], { type: comprovante.mime_type })
  });
  if (!response.ok) throw new Error(`Falha ao enviar comprovante (${response.status})`);
}

async function storageObjectExists(env: Env, auth: AuthContext, path: string) {
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/comprovantes/${path}`, {
    method: "HEAD",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${auth.accessToken}`
    }
  });
  return response.ok;
}

async function deleteStorage(env: Env, auth: AuthContext, path: string) {
  const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/comprovantes`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ prefixes: [path] })
  });
  if (!response.ok) throw new Error(`Falha ao remover comprovante (${response.status})`);
}

function extensionFor(comprovante: DownloadedComprovante) {
  const ext = MIME_TO_EXT[comprovante.mime_type];
  if (!ext) throw new Error("Tipo de comprovante não permitido.");
  return ext;
}

async function downloadComprovante(file: OpenAIFileInput, diagnostics: FileUploadDiagnostics): Promise<DownloadedComprovante> {
  if (!file?.download_url || !file.file_id) throw new Error("Comprovante não foi recebido pelo ChatGPT.");

  const response = await fetch(file.download_url, { method: "GET", redirect: "follow" });
  if (!response.ok) throw new Error(`Falha ao baixar comprovante (${response.status}).`);

  const headerMime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const mime = normalizeMime(headerMime || file.mime_type);
  if (!mime) throw new Error("Tipo de comprovante não permitido.");

  const informedSize = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(informedSize) && informedSize > 0) diagnostics.informed_size = informedSize;
  if (diagnostics.informed_size && diagnostics.informed_size > MAX_FILE_BYTES) throw new Error("Comprovante excede o limite de 10 MB.");

  const bytes = await readLimitedBytes(response, MAX_FILE_BYTES);
  diagnostics.downloaded_size = bytes.byteLength;
  validateDownloadedComprovante(bytes, mime, file.file_name);

  return {
    bytes,
    filename: safeFileName(file.file_name || `${file.file_id}.${MIME_TO_EXT[mime]}`),
    mime_type: mime,
    size: bytes.byteLength
  };
}

function validateDownloadedComprovante(bytes: Uint8Array, mime: DownloadedComprovante["mime_type"], filename?: string) {
  if (bytes.byteLength < MIN_FILE_BYTES) throw new Error("Comprovante vazio ou inválido.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("Comprovante excede o limite de 10 MB.");

  const expectedExt = MIME_TO_EXT[mime];
  const ext = filename?.split(".").pop()?.toLowerCase();
  if (ext && (expectedExt === "jpg" ? !["jpg", "jpeg"].includes(ext) : ext !== expectedExt)) {
    throw new Error("Extensão do comprovante não corresponde ao MIME type.");
  }

  if (mime === "image/png" && !hasMagic(bytes, [0x89, 0x50, 0x4e, 0x47])) throw new Error("Arquivo PNG inválido.");
  if (mime === "image/jpeg" && !hasMagic(bytes, [0xff, 0xd8, 0xff])) throw new Error("Arquivo JPEG inválido.");
  if (mime === "image/webp" && !(hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP"))) throw new Error("Arquivo WebP inválido.");
  if (mime === "application/pdf" && !hasAscii(bytes, 0, "%PDF")) throw new Error("Arquivo PDF inválido.");
}

function normalizeMime(value?: string): DownloadedComprovante["mime_type"] | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized in MIME_TO_EXT) return normalized as DownloadedComprovante["mime_type"];
  return null;
}

async function readLimitedBytes(response: Response, maxBytes: number) {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Comprovante excede o limite de 10 MB.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function storagePathFor(auth: AuthContext, obraId: string, comprovante: DownloadedComprovante) {
  const now = new Date();
  return `${auth.userId}/${obraId}/${now.getUTCFullYear()}/${pad2(now.getUTCMonth() + 1)}/${crypto.randomUUID()}.${extensionFor(comprovante)}`;
}

function safeFileName(value: string) {
  return value.replaceAll("\\", "/").split("/").pop()?.replace(/[^A-Za-z0-9._-]/g, "_") || "comprovante";
}

function hasMagic(bytes: Uint8Array, magic: number[]) {
  return magic.every((value, index) => bytes[index] === value);
}

function hasAscii(bytes: Uint8Array, offset: number, value: string) {
  return value.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

function logFileUploadDiagnostics(diagnostics: FileUploadDiagnostics) {
  console.log(JSON.stringify({ event: "soo_mcp_file_upload", timestamp: new Date().toISOString(), ...diagnostics }));
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_").replaceAll("*", "");
}

function joinObservation(...parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n") || null;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
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
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) return json({ error: "rate_limited" }, 429, request);
  return null;
}

function toolJson(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    _meta: { "mcp/www_authenticate": `Bearer resource_metadata="${RESOURCE_URL}${OAUTH_RESOURCE_METADATA_PATH}"` }
  };
}

function json(body: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request) }
  });
}

export async function withOpenAiToolDescriptors(response: Response, toolName: string | null) {
  if (toolName !== "tools/list" || !response.ok) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  const payload = await response.clone().json().catch(() => null);
  const decorated = decorateToolsListPayload(payload);
  if (decorated === payload) return response;

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(decorated), { status: response.status, statusText: response.statusText, headers });
}

export function decorateToolsListPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map((item) => decorateToolsListPayload(item));
  if (!payload || typeof payload !== "object") return payload;

  const record = payload as Record<string, any>;
  const result = record.result;
  if (!result || typeof result !== "object" || !Array.isArray(result.tools)) return payload;

  return {
    ...record,
    result: {
      ...result,
      tools: result.tools.map((tool: Record<string, any>) => {
        const securitySchemes = tool.securitySchemes ?? tool._meta?.securitySchemes;
        return securitySchemes ? { ...tool, securitySchemes } : tool;
      })
    }
  };
}

function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsHeaders(request?: Request) {
  const origin = request?.headers.get("origin") || "";
  const allowOrigin = isAllowedOrigin(origin) ? origin : "https://chatgpt.com";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version, www-authenticate",
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

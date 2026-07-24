import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer, decorateToolsListPayload } from "./index.js";

const EXPECTED_TOOLS = [
  "listar_obras",
  "buscar_contatos",
  "listar_categorias",
  "criar_despesa",
  "criar_despesa_com_comprovante",
  "atualizar_despesa"
];

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer(
  {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
  },
  {
    accessToken: "test-token",
    userId: "00000000-0000-0000-0000-000000000000"
  }
);
const client = new Client({ name: "soo-tools-list-test", version: "1.0.0" });

await server.connect(serverTransport);
await client.connect(clientTransport);

try {
  const result = await client.listTools();
  const parsed = ListToolsResultSchema.parse(result);
  const names = parsed.tools.map((tool) => tool.name);

  assertArrayEquals(names, EXPECTED_TOOLS, "tools/list deve expor exatamente as tools esperadas");

  for (const toolName of ["listar_obras", "buscar_contatos", "listar_categorias"]) {
    const tool = getTool(parsed, toolName);
    assert(tool.annotations?.readOnlyHint === true, `${toolName} deve ser read-only`);
    assert(tool.annotations?.destructiveHint === false, `${toolName} não deve ser destructive`);
    assert(tool.annotations?.openWorldHint === false, `${toolName} não deve ser open-world`);
    assertSecurityMirror(tool);
  }

  for (const toolName of ["criar_despesa", "criar_despesa_com_comprovante"]) {
    const tool = getTool(parsed, toolName);
    assert(tool.annotations?.readOnlyHint === false, `${toolName} deve ser mutável`);
    assert(tool.annotations?.destructiveHint === false, `${toolName} não deve ser destructive`);
    assert(tool.annotations?.idempotentHint === true, `${toolName} deve declarar idempotência`);
    assert(tool.annotations?.openWorldHint === false, `${toolName} não deve ser open-world`);
    assertSecurityMirror(tool);
  }

  const atualizar = getTool(parsed, "atualizar_despesa");
  assert(atualizar.annotations?.readOnlyHint === false, "atualizar_despesa deve ser mutável");
  assert(atualizar.annotations?.destructiveHint === false, "atualizar_despesa não deve ser destructive");
  assert(atualizar.annotations?.idempotentHint === false, "atualizar_despesa não é idempotente com os mesmos argumentos");
  assert(atualizar.annotations?.openWorldHint === false, "atualizar_despesa não deve ser open-world");
  assertSecurityMirror(atualizar);

  const criarDespesa = getTool(parsed, "criar_despesa");
  assert(!("comprovante" in (criarDespesa.inputSchema.properties ?? {})), "criar_despesa não deve ter parâmetro de arquivo");

  const criarComComprovante = getTool(parsed, "criar_despesa_com_comprovante");
  const comprovante = criarComComprovante.inputSchema.properties?.comprovante as any;
  assert(comprovante, "criar_despesa_com_comprovante deve ter comprovante");
  assert((criarComComprovante.inputSchema.required ?? []).includes("comprovante"), "comprovante deve ser obrigatório");
  assert(comprovante.type === "object", "comprovante deve ser objeto OpenAIFile");
  assertArrayEquals(comprovante.required ?? [], ["download_url", "file_id"], "OpenAIFile deve exigir apenas download_url e file_id");
  assert(comprovante.additionalProperties === false, "OpenAIFile não deve aceitar propriedades extras");
  assert(JSON.stringify(comprovante).includes("download_url"), "comprovante deve declarar download_url");
  assert(JSON.stringify(comprovante).includes("file_id"), "comprovante deve declarar file_id");
  assert(JSON.stringify(comprovante).includes("mime_type"), "comprovante deve declarar mime_type");
  assert(JSON.stringify(comprovante).includes("file_name"), "comprovante deve declarar file_name");
  assertArrayEquals((criarComComprovante._meta as any)["openai/fileParams"], ["comprovante"], "openai/fileParams deve apontar para comprovante");

  const decorated = decorateToolsListPayload({ jsonrpc: "2.0", id: 1, result: parsed }) as any;
  const decoratedTools = decorated.result.tools as Array<Record<string, any>>;
  for (const tool of decoratedTools) {
    assert(Array.isArray(tool.securitySchemes), `${tool.name} deve expor securitySchemes top-level para OpenAI`);
  }

  console.log(`tools/list ok: ${names.join(", ")}`);
} finally {
  await client.close();
  await server.close();
}

function getTool(result: { tools: Array<any> }, name: string) {
  const tool = result.tools.find((candidate) => candidate.name === name);
  assert(tool, `Tool ausente: ${name}`);
  return tool;
}

function assertSecurityMirror(tool: any) {
  assert(Array.isArray(tool._meta?.securitySchemes), `${tool.name} deve manter _meta.securitySchemes`);
}

function assertArrayEquals(actual: unknown[], expected: unknown[], message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}. Recebido: ${JSON.stringify(actual)}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

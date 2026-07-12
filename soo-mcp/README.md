# SOO MCP

Servidor MCP remoto do SOO para Cloudflare Workers.

Ele expõe ferramentas para o ChatGPT listar obras, buscar contatos, listar categorias e criar uma despesa com comprovante no Supabase após confirmação do usuário.

## Segurança

- O Worker exige `Authorization: Bearer SOO_MCP_API_TOKEN`.
- O front-end do SOO não usa nem recebe `SUPABASE_SERVICE_ROLE_KEY`.
- A chave `service_role` deve existir apenas como secret do Worker ou em `.dev.vars` local.
- O ChatGPT nunca envia `owner_id`; o Worker sempre usa `SOO_OWNER_ID`.
- O endpoint `/health` retorna apenas `{ "status": "ok" }`.

## Estrutura

```text
soo-mcp/
  package.json
  tsconfig.json
  wrangler.jsonc
  src/index.ts
  README.md
  .dev.vars.example
```

## Instalar dependências

```bash
cd soo-mcp
npm install
```

## Login no Wrangler

```bash
npx wrangler login
npx wrangler whoami
```

## Configurar secrets

Nunca commit `.dev.vars` com valores reais.

Para desenvolvimento local, copie o exemplo:

```bash
cp .dev.vars.example .dev.vars
```

Preencha em `.dev.vars`:

```text
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SOO_MCP_API_TOKEN=...
SOO_OWNER_ID=...
```

Para produção, grave os secrets no Cloudflare:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SOO_MCP_API_TOKEN
npx wrangler secret put SOO_OWNER_ID
```

## Executar localmente

```bash
npm run dev
```

Endpoint local:

```text
http://localhost:8787/mcp
```

Health:

```bash
curl http://localhost:8787/health
```

## Publicar

Depois de revisar os arquivos e configurar os secrets:

```bash
npm run deploy
```

URL MCP publicada:

```text
https://soo-mcp.<sua-conta>.workers.dev/mcp
```

## Conectar ao ChatGPT

No ChatGPT, cadastre um conector/MCP remoto usando:

```text
https://soo-mcp.<sua-conta>.workers.dev/mcp
```

Configure o cabeçalho:

```text
Authorization: Bearer <SOO_MCP_API_TOKEN>
```

## Ferramentas MCP

### listar_obras

Sem parâmetros.

Retorna:

- `id`
- `nome`
- `cliente`
- `cidade`
- `status`

### buscar_contatos

Parâmetros:

```json
{ "termo": "joao" }
```

Retorna:

- `id`
- `nome`
- `tipos`
- `cpf_cnpj`
- `telefone`

### listar_categorias

Retorna a lista inicial de categorias do SOO.

### criar_despesa_com_comprovante

Parâmetros principais:

```json
{
  "obra_id": "uuid-da-obra",
  "descricao": "Compra de argamassa",
  "valor": 123.45,
  "data": "2026-07-12",
  "contato_id": "uuid-opcional",
  "contato_nome": "Nome opcional sem criar contato",
  "quem_pagou": "Murakami",
  "categoria": "A classificar",
  "observacao": "Texto opcional",
  "idempotency_key": "chave-unica-da-solicitacao",
  "confirmacao_usuario": true,
  "comprovante": {
    "filename": "comprovante.png",
    "mime_type": "image/png",
    "data_base64": "iVBORw0KGgo..."
  }
}
```

O campo `comprovante` aceita:

- `image/jpeg`
- `image/png`
- `image/webp`
- `application/pdf`

Limite: 10 MB.

O arquivo é salvo no bucket privado `comprovantes` em:

```text
SOO_OWNER_ID/obra_id/AAAA/MM/uuid.ext
```

O banco salva apenas `comprovante_path`.

## Testar MCP com curl

Defina:

```bash
export MCP_URL=http://localhost:8787/mcp
export MCP_TOKEN=seu-token
```

Inicializar:

```bash
curl -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

Listar ferramentas:

```bash
curl -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Listar obras:

```bash
curl -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"listar_obras","arguments":{}}}'
```

Buscar contatos:

```bash
curl -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"buscar_contatos","arguments":{"termo":"fornecedor"}}}'
```

## Testar upload de arquivo

Gere base64:

```bash
base64 -i comprovante.png
```

Use o valor em `data_base64` ao chamar `criar_despesa_com_comprovante`.

Importante: primeiro o ChatGPT deve interpretar o comprovante e pedir confirmação ao usuário. Só chame a ferramenta com `confirmacao_usuario: true` após a confirmação.

## Idempotência

A ferramenta aceita `idempotency_key`. Se a mesma chave for usada novamente, o Worker retorna a despesa já criada e não insere duplicidade.

Quando a chave não é enviada, o Worker calcula uma chave a partir dos principais campos e do comprovante.

## Revogar o token

Gere um novo token forte e atualize o secret:

```bash
npx wrangler secret put SOO_MCP_API_TOKEN
```

Depois faça um novo deploy, se necessário:

```bash
npm run deploy
```

Para remover o secret:

```bash
npx wrangler secret delete SOO_MCP_API_TOKEN
```

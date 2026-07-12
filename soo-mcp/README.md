# SOO MCP

Servidor MCP remoto do SOO para Cloudflare Workers, protegido por OAuth 2.1 do Supabase Auth.

## Endpoints

- Worker: `https://soo-mcp.rymurakami.workers.dev`
- MCP: `https://soo-mcp.rymurakami.workers.dev/mcp`
- Health: `https://soo-mcp.rymurakami.workers.dev/health`
- Protected Resource Metadata: `https://soo-mcp.rymurakami.workers.dev/.well-known/oauth-protected-resource`
- Authorization Server: `https://nlfzjmruzmstrysuohxl.supabase.co/auth/v1`
- Authorization Server Discovery: `https://nlfzjmruzmstrysuohxl.supabase.co/.well-known/oauth-authorization-server/auth/v1`

## Segurança

- Não usa `SUPABASE_SERVICE_ROLE_KEY`.
- Não usa `SOO_OWNER_ID`.
- Nunca aceita `owner_id` como argumento.
- Extrai o usuário exclusivamente do `sub` do access token Supabase.
- Valida JWT pelo JWKS público do Supabase.
- Usa o access token do usuário nas chamadas REST/Storage ao Supabase.
- Todas as operações dependem das políticas RLS atuais.

## Variáveis do Worker

Configuradas em `wrangler.jsonc`:

```json
{
  "SUPABASE_URL": "https://nlfzjmruzmstrysuohxl.supabase.co",
  "SUPABASE_PUBLISHABLE_KEY": "..."
}
```

Não configure secrets de service role neste Worker.

## Ferramentas MCP

### listar_obras

Lista obras do usuário autenticado.

### buscar_contatos

Busca contatos por `termo` nos campos `nome`, `cpf_cnpj` e `telefone`.

### listar_categorias

Retorna as categorias iniciais do SOO.

### criar_despesa_com_comprovante

Cria despesa confirmada, envia comprovante ao bucket privado `comprovantes`, salva `origem = "chatgpt"` e usa `idempotency_key` para evitar duplicidade.

Formato do comprovante:

```json
{
  "filename": "comprovante.png",
  "mime_type": "image/png",
  "data_base64": "..."
}
```

MIME types aceitos:

- `image/jpeg`
- `image/png`
- `image/webp`
- `application/pdf`

Limite: 10 MB.

### atualizar_despesa

Atualiza campos editáveis da despesa do usuário autenticado. Não permite alterar `owner_id` nem `obra_id`.

## Instalar e validar

```bash
npm install
npm run typecheck
npm run deploy
```

Neste ambiente Codex, quando `npm` não estiver no PATH:

```bash
pnpm dlx npm@11.6.4 install --ignore-scripts
pnpm dlx npm@11.6.4 run typecheck
pnpm dlx npm@11.6.4 run deploy
```

## Consentimento no SOO

O app Pages deve servir a rota:

```text
https://soo-app.pages.dev/oauth/consent
```

Essa rota lê `authorization_id`, exige sessão Supabase do usuário SOO, chama:

- `supabase.auth.oauth.getAuthorizationDetails(authorization_id)`
- `supabase.auth.oauth.approveAuthorization(authorization_id)`
- `supabase.auth.oauth.denyAuthorization(authorization_id)`

e redireciona para `data.redirect_url`.

# SOO MCP

Servidor MCP remoto do SOO para Cloudflare Workers.

Esta versão é uma prova de compatibilidade de anexos entre ChatGPT e um servidor MCP remoto. Ela não usa `SUPABASE_SERVICE_ROLE_KEY`, não cria despesas e não grava arquivos.

## Estado desta etapa

- Transporte: Streamable HTTP via SDK oficial TypeScript do MCP.
- SDK MCP: `@modelcontextprotocol/sdk@1.29.0`.
- Endpoint MCP: `/mcp`.
- Health check: `/health`.
- Autenticação: temporariamente desativada para permitir cadastro do conector no ChatGPT com a opção "Sem autenticação".
- Ferramenta publicada: `testar_recebimento_comprovante`.
- Nenhuma ferramenta de Supabase ou criação de despesa é registrada nesta publicação.

## Estrutura

```text
soo-mcp/
  package.json
  package-lock.json
  tsconfig.json
  wrangler.jsonc
  src/index.ts
  README.md
  .dev.vars.example
```

## Instalar dependências

O comando esperado em uma máquina com npm é:

```bash
cd soo-mcp
npm install
```

Neste ambiente local do Codex, `npm` não está instalado diretamente no PATH. Para validar a etapa, o npm foi executado via runtime temporário:

```bash
pnpm dlx npm@11.6.4 install --ignore-scripts
pnpm dlx npm@11.6.4 run typecheck
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

## Secrets

Nenhum secret é necessário para a prova pública sem autenticação.

`.dev.vars.example` existe apenas para documentar que não há variável obrigatória nesta etapa.

Na etapa futura com autenticação, grave secrets no Cloudflare, nunca no repositório:

```bash
npx wrangler secret put SOO_MCP_API_TOKEN
```

## Ferramentas MCP

### testar_recebimento_comprovante

Ferramenta temporária para verificar se um comprovante chega aos argumentos da chamada MCP.

Retorno:

- `recebido`
- `filename`
- `mime_type`
- `tamanho_bytes`
- `sha256`

O conteúdo do arquivo nunca é retornado.

### Formato aceito para arquivo

O MCP define argumentos de ferramentas por JSON Schema. Na especificação atual, há conteúdo binário em resultados (`image`, `audio`) e recursos, mas não há um tipo universal de argumento binário que obrigue clientes como o ChatGPT a converter automaticamente anexos do usuário em um parâmetro da ferramenta.

Por isso, esta ferramenta aceita explicitamente este formato JSON para teste manual/protocolar:

```json
{
  "comprovante": {
    "filename": "comprovante.png",
    "mime_type": "image/png",
    "data_base64": "iVBORw0KGgo..."
  }
}
```

MIME types aceitos:

- `image/jpeg`
- `image/png`
- `image/webp`
- `application/pdf`

Limite: 10 MB.

Importante: este formato não significa que o ChatGPT preencherá `data_base64` automaticamente quando o usuário anexar uma imagem na conversa. A prova serve justamente para observar se o cliente MCP remoto encaminha algum conteúdo de anexo aos argumentos. Se nada chegar, a ferramenta retorna `recebido: false`.

### Ferramentas não publicadas nesta prova

`criar_despesa_com_comprovante`, `listar_obras`, `buscar_contatos` e `listar_categorias` não são registradas nesta publicação.

Enquanto a prova de anexos não for concluída, o Worker não:

- lê `SUPABASE_SERVICE_ROLE_KEY`;
- lê `SOO_OWNER_ID`;
- envia arquivo ao Storage;
- cria registro em `despesas`;
- grava qualquer conteúdo.

## Idempotência futura

Na reativação de `criar_despesa_com_comprovante`, a idempotência deve sair de `observacao` e ir para uma coluna própria.

SQL recomendado para revisão antes de aplicar:

```sql
alter table public.despesas
add column if not exists idempotency_key text;

create unique index if not exists despesas_owner_id_idempotency_key_key
on public.despesas (owner_id, idempotency_key)
where idempotency_key is not null;
```

Fluxo futuro:

- exigir ou gerar `idempotency_key`;
- consultar `despesas` por `owner_id + idempotency_key`;
- se existir, retornar a despesa já criada;
- se não existir, fazer upload, inserir despesa e salvar `idempotency_key`;
- se o insert falhar depois do upload, remover o arquivo enviado.

## Testar com curl

Defina:

```bash
export MCP_URL=http://localhost:8787/mcp
```

Inicializar:

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

Listar ferramentas:

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Testar sem arquivo:

```bash
curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"testar_recebimento_comprovante","arguments":{}}}'
```

Testar com arquivo em base64:

```bash
BASE64=$(base64 -i comprovante.png)

curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"testar_recebimento_comprovante\",\"arguments\":{\"comprovante\":{\"filename\":\"comprovante.png\",\"mime_type\":\"image/png\",\"data_base64\":\"$BASE64\"}}}}"
```

## Conectar ao ChatGPT para a prova

Cadastre a URL:

```text
https://soo-mcp.<sua-conta>.workers.dev/mcp
```

Autenticação: selecione "Sem autenticação".

Teste esperado:

1. Enviar uma imagem de comprovante ao ChatGPT.
2. Pedir para chamar `testar_recebimento_comprovante`.
3. Verificar se os argumentos da ferramenta receberam algum arquivo.
4. Se a resposta for `recebido: false`, o ChatGPT não encaminhou o anexo como argumento MCP no formato usado nesta prova.

## Publicar

Depois de revisar:

```bash
npm run deploy
```

## Reativar autenticação futuramente

Quando a prova terminar, reative a validação de `Authorization` no Worker e grave um token forte como secret:

```bash
npx wrangler secret put SOO_MCP_API_TOKEN
```

Para remover um token antigo:

```bash
npx wrangler secret delete SOO_MCP_API_TOKEN
```

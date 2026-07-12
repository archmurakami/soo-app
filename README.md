# SOO - Sistema Operacional de Obras

MVP funcional do SOO conectado ao Supabase, com app único multiobras, autenticação por e-mail, despesas, contatos rápidos, comprovantes e seção de Reuniões.

## Configurar Supabase

O projeto SOO ja esta conectado em `js/supabase-client.js` com:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Para trocar de projeto no futuro, edite o mesmo arquivo:

```js
export const SUPABASE_URL = "https://SEU_PROJETO.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "SUA_CHAVE_PUBLICA";
```

Use a chave publica/publishable do projeto. Nunca coloque `service_role` ou qualquer chave privada no front-end.

O app usa as tabelas existentes:

- `obras`
- `contatos`
- `despesas`

O campo `owner_id` e sempre preenchido com o `id` do usuario autenticado.

## Comprovantes

O upload esta preparado para o bucket `comprovantes`, no caminho:

```text
usuario_id/obra_id/nome_do_arquivo
```

Se o bucket ainda nao existir, ou se as politicas de Storage bloquearem o upload, o SOO mostra uma mensagem clara e salva a despesa sem comprovante.

## Executar localmente

Como o app usa modulos ES e service worker, execute com um servidor local:

```bash
npx serve .
```

Ou, com Python:

```bash
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## Publicar no Cloudflare Pages

1. Conecte este repositorio ao Cloudflare Pages.
2. Use as configuracoes:
   - Framework preset: `None`
   - Build command: deixe vazio
   - Build output directory: `/`
3. Publique.
4. No Supabase Auth, adicione a URL publicada em Authentication > URL Configuration:
   - Site URL
   - Redirect URLs

## Testar login

1. Abra o app local ou publicado.
2. Crie o usuario manualmente no Supabase Auth, se ele ainda nao existir.
3. Informe `Email` e `Senha` na tela inicial do SOO.
4. Clique em `Entrar`.
5. Confirme que o app abre `MINHAS OBRAS` e permanece conectado ao recarregar a pagina.

## Testar uma despesa

1. Entre no app.
2. Clique em `+ Nova obra` e cadastre uma obra.
3. Abra a obra.
4. Clique em `+ Nova despesa`.
5. Preencha descricao, valor e data.
6. Pesquise um contato; se nao existir, use o cadastro rapido sem sair do fluxo.
7. Mantenha categoria como `A classificar` para salvar `status_classificacao = a_classificar`, ou informe outra categoria para salvar `classificada`.
8. Salve a despesa.
9. Confira a lista, o total da obra, o contador de despesas a classificar e os filtros.

## PWA no iPhone e iPad

O projeto inclui `manifest.json`, `service-worker.js`, `theme-color` e `apple-touch-icon`.

No Safari do iPhone/iPad, abra o site publicado, toque em Compartilhar e escolha `Adicionar à Tela de Início`.

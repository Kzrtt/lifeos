# Instalação

Duas formas: **com uma IA** (10 minutos, ela faz quase tudo) ou **manual**
(30 minutos, você entende cada passo). As duas chegam no mesmo lugar.

Você vai precisar de uma conta no [GitHub](https://github.com) e uma no
[Supabase](https://supabase.com). Ambas gratuitas, e o plano free cobre
folgadamente o uso de uma pessoa.

---

## Caminho A — com uma IA

Funciona em qualquer assistente com os conectores **Supabase** e **GitHub**
habilitados (Claude, por exemplo). A IA cria o projeto, roda o SQL, sobe as
funções e edita a configuração.

### 1. Forke o repositório

Abra **https://github.com/Kzrtt/lifeos** e clique em **Fork** → escolha o nome
→ **Create fork**.

Depois, em **Settings → Pages** do seu fork: *Source* = **Deploy from a
branch**, branch **main**, pasta **/ (root)**. O endereço será
`https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

### 2. Cole este prompt

> Instale o LifeOS a partir do meu fork em `SEU-USUARIO/NOME-DO-REPO`.
>
> 1. Crie um projeto Supabase novo chamado `lifeos` na região mais próxima de
>    mim e espere ficar ativo.
> 2. Aplique todos os arquivos de `supabase/migrations/` em ordem numérica
>    (`0001_init.sql`, `0002_…`, …) e depois `supabase/seed.sql`, exatamente
>    como estão no repositório.
> 3. Faça o deploy de todas as funções em `supabase/functions/`, **exceto** as
>    que começam com `notion-`. Todas com `verify_jwt = false`.
> 4. Pegue a URL do projeto e a chave publicável (anon) e edite
>    `assets/js/lifeos-config.js` no meu fork: `supabaseUrl`, `anonKey`, e
>    `gh.owner` / `gh.repo` apontando para o meu fork. Commite na `main`.
> 5. Gere um token aleatório de 32 bytes em hexadecimal e grave em
>    `admin_config`, chave `mcp_token`, substituindo o placeholder.
> 6. Me diga: a URL do site, a senha mestre inicial, e o que eu preciso fazer
>    à mão.

### 3. Faça os três passos que sobram

A IA não consegue fazer estes por você:

- **Troque a senha mestre.** Abra `SEU-SITE/lifeos/lifeos.html`, entre com
  `lifeos`, e vá em **menu → Senhas**. Faça isso antes de qualquer outra coisa.
- **Cadastre o token do GitHub**, se quiser publicar páginas pelo sistema.
  **menu → Publicar → aba Token do GitHub** tem o passo a passo.
- **Conecte o MCP**, se quiser que uma IA leia o seu sistema.
  **menu → MCP** mostra a URL pronta.

---

## Caminho B — manual

### 1. Forke e ligue o Pages

Igual ao passo 1 do caminho A.

### 2. Crie o projeto Supabase

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
Escolha a região mais próxima de você — ela define a latência de tudo. Guarde
a senha do banco; você não vai precisar dela agora, mas perdê-la dá trabalho.

### 3. Crie o schema

No dashboard, **SQL Editor** → **New query**. Cole o conteúdo de
`supabase/migrations/0001_init.sql` e rode. Repita com cada arquivo seguinte
de `supabase/migrations/`, **em ordem numérica** (`0002_…`, `0003_…`, …) —
cada um depende dos anteriores. Por último, `supabase/seed.sql`.

Deve terminar sem erro. Em **Table Editor** você verá as tabelas `lifeos_*`; em
`access_tokens` haverá uma linha com o token `lifeos`.

### 4. Suba as Edge Functions

Instale o CLI e autentique:

```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU-PROJECT-REF
```

O *project ref* é o código na URL do dashboard
(`supabase.com/dashboard/project/`**`xxxxxxxx`**).

```bash
for fn in lifeos-config lifeos-senhas lifeos-projetos lifeos-tarefas \
          lifeos-eventos lifeos-notas lifeos-manifestacoes \
          lifeos-movimentacoes lifeos-ingest lifeos-views \
          lifeos-vocabularios lifeos-citacoes lifeos-mcp; do
  supabase functions deploy "$fn" --no-verify-jwt
done
```

`--no-verify-jwt` é obrigatório. Sem ele o runtime exige um JWT do Supabase
antes do código rodar, e a autenticação deste projeto é a senha mestre
enviada no corpo — não um JWT.

As funções `notion-*` são scripts de migração pessoais do autor original.
Não faça deploy delas.

### 5. Aponte o front para o seu projeto

Em **Project Settings → API**, copie a **Project URL** e a chave
**publishable / anon**.

Edite `assets/js/lifeos-config.js` no seu fork:

```js
window.LIFEOS_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  anonKey:     'eyJhbGciOi...',
  gh: { owner: 'seu-usuario', repo: 'seu-repo', branch: 'main' },
  identidade: { nome: 'LifeOS', sub: 'sua descrição' },
  tema: 'sepia',
  sessionKey: 'financas_master',
};
```

É o **único** arquivo que precisa ser editado. Commite e dê push.

> A `anonKey` é pública por natureza — ela vai no código do site e é isso
> mesmo. Ela não dá acesso a nada sozinha: as tabelas têm RLS e só a
> `service_role`, que vive dentro das Edge Functions, alcança os dados.
> **Nunca** coloque a service role key neste arquivo.

### 6. Gere o token do MCP

Só se for usar o conector de IA.

```bash
openssl rand -hex 32
```

No **SQL Editor**:

```sql
update public.admin_config
   set value = 'COLE-O-VALOR-AQUI', updated_at = now()
 where key = 'mcp_token';
```

O `seed.sql` deixa um placeholder inválido de propósito: enquanto não for
trocado, o conector recusa toda conexão. É melhor nascer travado do que
nascer aberto com um valor que está publicado no repositório.

### 7. Entre e troque a senha

Abra `https://SEU-USUARIO.github.io/SEU-REPO/lifeos/lifeos.html`, senha
`lifeos`, e vá direto em **menu → Senhas**.

---

## Depois de instalar

Há uma lista de tarefas esperando por você dentro do sistema — o `seed.sql`
cria um projeto "Configurar o LifeOS" com o que falta.

**menu → Como funciona** explica cada módulo, o raciocínio por trás do
projeto e uma ordem de adoção que evita o erro clássico de encher tudo num
fim de semana e abandonar na terça.

---

## Se algo der errado

**Todas as chamadas falham com erro de CORS.** As funções não subiram, ou
subiram sem `--no-verify-jwt`. Confira em **Edge Functions** no dashboard se
todas aparecem como *Active*.
(O CORS em si não deveria travar: o padrão é aceitar qualquer origem. Se você
definiu o secret `LIFEOS_ALLOWED_ORIGIN`, confira se bate com o seu domínio,
incluindo `https://` e sem barra no fim.)

**"senha incorreta" com a senha `lifeos`.** O `seed.sql` não rodou, ou rodou
antes da migration. Confira em **Table Editor → access_tokens** se existe a
linha.

**O site abre mas o index está vazio.** Normal num fork novo: as entradas vêm
de `assets/js/manifest.js`, e ele ainda tem as do autor original. Apague o
array `entries` (deixe `[]`) para começar do zero.

**O conector MCP recusa conexão.** O `mcp_token` ainda é o placeholder. Volte
ao passo 6.

**O publish falha com 401 ou 403.** O token do GitHub expirou, ou não tem a
permissão **Contents: Read and write** no repositório certo.
**menu → Publicar → aba Token do GitHub** refaz o cadastro.

---

## O que é gratuito e o que não é

| Serviço | Plano free | Onde aperta |
|---|---|---|
| GitHub Pages | ilimitado em repo público | precisa ser público |
| Supabase | 500MB de banco, 5GB de banda, 2 projetos | o banco pausa após 1 semana sem uso — basta abrir o dashboard para reativar |

O uso real de uma pessoa fica muito abaixo desses limites: este projeto, com
mais de 700 registros e 27 páginas, ocupa poucos megabytes.

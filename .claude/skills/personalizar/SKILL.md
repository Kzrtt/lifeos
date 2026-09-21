---
name: personalizar
description: Entrevista o dono de uma instância nova do LifeOS e aplica a personalização — identidade, backend, tema, limpeza do conteúdo do autor original e checagem do que falta configurar. Trigger - /personalizar
trigger: /personalizar
---

# /personalizar

Transforma um fork recém-instalado numa instância que é **do usuário**: nome,
identidade visual, backend apontado para o projeto dele, e o conteúdo do autor
original removido.

Roda depois do [`SETUP.md`](../../../SETUP.md). Se o schema ainda não foi
aplicado, mande o usuário fazer isso primeiro — sem banco não há o que
personalizar.

## Uso

```
/personalizar              # entrevista completa
/personalizar --revisar    # só relata o que ainda está com a cara do autor original
```

---

## Como conduzir

**Pergunte em blocos, não tudo de uma vez.** São cinco blocos; apresente um,
espere a resposta, aplique, confirme o que mudou, siga. Uma entrevista de 20
perguntas seguidas faz a pessoa desistir na quinta.

**Use os padrões.** Toda pergunta abaixo tem um valor razoável entre
colchetes. Ofereça-o explicitamente ("posso deixar X?") em vez de exigir
resposta. Quem só quer começar deve conseguir dizer "tanto faz" cinco vezes e
terminar com um sistema coerente.

**Não invente dados do usuário.** Se ele não responder algo, deixe como está e
registre no relatório final. Nunca preencha nome, descrição ou imagem por
conta própria.

**Mostre o efeito.** Depois de cada bloco, diga em uma linha o que mudou e
onde. A pessoa está editando um sistema que ainda não conhece.

---

## Bloco 1 — Identidade

O que aparece no topo do painel e no título das abas.

| Pergunta | Onde vai | Padrão |
|---|---|---|
| Como o painel se chama? | `LIFEOS_CONFIG.identidade.nome` | `LifeOS` |
| Uma linha abaixo do nome? | `.identidade.sub` | `gestão de vida` |
| Como o site público se chama? | `<title>` das páginas | o nome do repositório |
| Tem banner e avatar? (caminhos de imagem) | `.identidade.banner` / `.avatar` | manter os atuais |

Aplicar em `assets/js/lifeos-config.js`. O `<title>` fica **fora** da config
de propósito — ele carrega o nome do site, não o do painel; edite no HTML.

Se o usuário não tiver imagens próprias, avise que as atuais são do autor
original e pergunte se prefere remover (o layout aguenta sem elas).

## Bloco 2 — Backend

Só se o `SETUP.md` não tiver sido seguido ainda, ou se algo estiver errado.

| Pergunta | Onde vai |
|---|---|
| URL do projeto Supabase | `LIFEOS_CONFIG.supabaseUrl` |
| Chave publicável (anon) | `.anonKey` |
| Usuário e repositório no GitHub | `.gh.owner` / `.gh.repo` |

**Confira antes de perguntar**: leia `lifeos-config.js`. Se já estiver
apontando para um projeto que não é o do autor original, está configurado — confirme e siga.

Nunca peça, aceite ou grave a **service role key**. Ela vive só nos secrets
das Edge Functions. Se o usuário oferecer, recuse e explique.

## Bloco 3 — Aparência

| Pergunta | Onde vai | Padrão |
|---|---|---|
| Qual paleta? (sepia, noite, carvao, floresta, ardosia, vinho, indigo, cobre, abismo) | `LIFEOS_CONFIG.tema` | `sepia` |

Cada tema tem versão escura (painel) e clara (capa). Se o usuário quiser uma
paleta própria, explique que são **dois** arquivos com o mesmo nome —
`assets/css/themes/lifeos/<slug>.css` e `assets/css/themes/blog/<slug>.css` —
mais o registro em `VALIDOS` (`assets/js/tema.js`) e `TEMAS`
(`assets/js/temas.js`). Ofereça criar.

Troque também o `href` do `<link id="lifeos-tema">` nas páginas, que é o
padrão sem JS.

## Bloco 3.5 — O blog é necessário?

**Pergunte antes do bloco 4** — a resposta muda o que faz sentido apagar.

| Pergunta | Onde vai | Padrão |
|---|---|---|
| Você vai publicar páginas públicas, ou quer só o painel? | `LIFEOS_CONFIG.blog.habilitado` | `true` |

Se a resposta for "só o painel", ponha `blog: { habilitado: false }`. Isso
esconde "Publicar página", o link para o arquivo, o escopo por página em
Senhas, e faz a raiz do site levar ao painel.

Explique que é reversível e não apaga nada — os arquivos continuam lá. Quem
desligar o blog provavelmente vai querer apagar as páginas do autor original
no bloco seguinte, mas são decisões separadas: dá para desligar sem apagar.

## Bloco 4 — Conteúdo do autor original

**É aqui que o fork deixa de ser um clone.** Pergunte um por um; são
destrutivos e a pessoa precisa decidir cada um.

| Pergunta | O que fazer se sim |
|---|---|
| Apagar as entradas do arquivo? | esvaziar `entries` em `manifest.js` **e** `manifest.json`; apagar os `.html` de `pages/` |
| Apagar as seções extras? | remover `galeria.html`, `jogo.html`, `profissional.html`, `qui-videti/`, `legacy.html` e os links no rodapé do `index.html` |
| Apagar as imagens? | `assets/images/` e `assets/gallery/` |
| Remover os scripts de migração do Notion? | apagar `supabase/functions/notion-*` |

Ao mexer no manifest, faça o **cache-busting**: bump de `meta.version` nos
dois arquivos e do `?v=` no `index.html`. Sem isso o visitante continua vendo
a listagem antiga por até 10 minutos.

Ao remover páginas, procure links órfãos antes (`grep -rn "nome-do-arquivo"`)
— rodapés e `llms.txt` apontam para várias delas.

## Bloco 5 — Segurança

Não é opcional. Verifique e insista.

1. **A senha mestre ainda é `lifeos`?** Consulte `access_tokens`. Se for,
   pare tudo e mande trocar em **menu → Senhas** antes de continuar. Enquanto
   for a padrão, qualquer pessoa que conheça o projeto entra no painel.
2. **O `mcp_token` ainda é o placeholder?** Se o usuário for usar o conector,
   gere (`openssl rand -hex 32`) e grave em `admin_config`. Se não for usar,
   deixe o placeholder — ele mantém o servidor recusando tudo.
3. **O `github_pat` está cadastrado?** Só é preciso para publicar páginas. Se
   o usuário quiser, mande para **menu → Publicar → aba Token do GitHub**, que
   tem o passo a passo. **Não peça o token no chat** — ele é cadastrado pela
   tela, e não deve passar por aqui.

---

## Fechamento

Termine com um relatório curto:

- o que foi alterado, por arquivo
- o que ficou como estava, e por quê (não respondido, ou escolha do usuário)
- **o que só o usuário pode fazer** — trocar a senha, cadastrar o PAT,
  conectar o MCP
- o comando de commit, se houver mudança em arquivo versionado

Depois aponte para **menu → Como funciona** (`lifeos/tutorial.html`), que
explica os módulos e sugere uma ordem de adoção.

---

## Modo `--revisar`

Sem perguntar nada, relate o que ainda tem a cara do autor original:

```
grep -rn "SEU-USUARIO\|LifeOS\|LifeOS" --include=*.html --include=*.js . | grep -v node_modules
grep -rn "o project ref do autor original" --include=*.html --include=*.js .
```

E consulte o banco: senha mestre ainda `lifeos`? `mcp_token` ainda
placeholder? `manifest.js` ainda com as entradas originais?

Apresente como lista de pendências com o comando de correção ao lado de cada
uma. Não altere nada neste modo.

---

## O que nunca fazer

- Pedir, aceitar ou gravar a **service role key** em qualquer arquivo do repo
- Pedir o **PAT do GitHub** no chat — ele é cadastrado pela tela de Publicar
- Apagar conteúdo sem confirmação explícita, um item por vez
- Preencher identidade, descrição ou imagens por conta própria quando o
  usuário não respondeu
- Mexer no manifest sem o cache-busting
- Prosseguir com a senha mestre ainda em `lifeos`

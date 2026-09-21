# CLAUDE.md — LifeOS

> Leia este arquivo inteiro antes de qualquer ação no projeto.
> Os docs auxiliares em `docs/` são referenciados em cada seção.

---

## O que é este projeto

Um sistema de gestão de vida auto-hospedado (**LifeOS**, em `lifeos/`) com um
**blog estático opcional** ao lado (`index.html` + `pages/`). Roda em GitHub
Pages, com Supabase como backend da parte dinâmica.

**Sem build step, sem framework, sem `node_modules`.** HTML, CSS e JS crus.
`git push` publica.

**Stack:**
- HTML + CSS + JS cru. Nenhuma dependência de build.
- Chart.js e marked.js via CDN, só nas páginas do painel que precisam.
- Font Awesome 5 **Free** (`assets/css/icons.css` + `assets/webfonts/free-*`).
  As classes no markup dizem `fad`, herdado do Pro — o CSS as aponta para a
  família Solid livre. **Nunca adicione arquivos do FA Pro aqui**: é produto
  licenciado e o repositório é público.
- Supabase: 12 tabelas, Edge Functions, RLS sem policy (só `service_role`).

**Duas metades, desligáveis:** `LIFEOS_CONFIG.blog.habilitado = false`
desliga a parte pública. Ver [`LIFEOS.md`](../docs/LIFEOS.md) §16.

---

## A regra que explica o resto do código

**Cada página do `lifeos/` é isolada.** Sem imports cruzados, sem uma página
lendo funções ou estado de outra. Padrões repetidos (gate, modo local,
confirmação de exclusão) são **copiados**, não compartilhados.

Isso é deliberado, não descuido. Ver [`LIFEOS.md`](../docs/LIFEOS.md) §2 para
o histórico. A consequência prática: **ajustar um padrão num arquivo não muda
os outros** — se o ajuste vale em todos, replique à mão.

Duas exceções, ambas dados declarativos carregados por `<script>`:
`assets/js/lifeos-config.js` (config da instância) e `assets/js/tema.js`
(troca o `href` de um `<link>`). Nenhuma das duas guarda estado ou regra de
negócio, e nenhuma página deve pôr helpers ali para outra consumir.

---

## Armadilhas que já custaram bugs

Todas descobertas em produção. Leia antes de criar uma página nova.

**`[hidden]` não funciona sozinho.** Toda página precisa de
`[hidden] { display: none !important; }` no `<style>`. Sem isso,
`el.hidden = true` não esconde nada em elementos cuja classe declare
`display` — e `.gate`, `.modal` e `.loading-ov` todas declaram. O sintoma é a
página travar em "verificando sessão…" ou um spinner permanente.

**Ao copiar a casca de outra página, audite as classes.** Copiar o `<style>`
de uma página existente perde silenciosamente qualquer regra fora do trecho
copiado. Foi assim que `.row-btn` sumiu e os botões viraram `<button>` cru.
Compare as classes usadas no JS contra as que têm regra no CSS.

**Nunca chape a cor de um token.** `rgba(196,145,58,0.32)` não segue o tema.
Se precisa de transparência, derive: `color-mix(in srgb, var(--gold) 32%, transparent)`.

**Seletor montado no `init()` não vê o vocabulário.** `init()` roda antes de
`carregarVocab`. Qualquer picker construído a partir de uma lista de tags
precisa ser reconstruído quando o vocabulário chega — ver `renderEventoTipoPicker`.

**Antes de deployar uma Edge Function, confira se o repo está à frente.** Um
deploy já regrediu a produção porque o arquivo versionado estava desatualizado
em relação ao que rodava. Compare o que o front manda e lê contra o que a
function aceita e devolve.

---

## Vocabulários são dados, não constantes

Tags e status vivem em `lifeos_vocabularios` e são editáveis em
**LifeOS → menu → Tags**. As constantes no código são **fallback**, para o
sistema degradar para o vocabulário de ontem em vez de ficar sem nenhum.

Renomear um valor **migra os dados** na mesma transação. Valores marcados
`protegido` (`Feito`, `Entrada`, `Crédito`…) são lidos pela lógica por nome:
podem ser renomeados, nunca apagados. Ver [`LIFEOS.md`](../docs/LIFEOS.md) §14.

---

## Identidade visual

Lê [`VISUAL.md`](../docs/VISUAL.md) antes de escrever HTML/CSS.

- Fundo escuro no painel, claro no blog. Nove temas, cada um em duas versões
  (`assets/css/themes/lifeos/` e `/blog/`) — ver [`LIFEOS.md`](../docs/LIFEOS.md) §12
- Playfair Display para títulos, JetBrains Mono para o resto
- Nenhuma fonte genérica (Inter, Roboto, system-ui)
- As entradas do blog têm paleta própria cada uma: é o ponto, não um descuido

---

## O que nunca fazer

- Adicionar framework, build step ou `node_modules`
- Adicionar arquivos do **Font Awesome Pro** — é licenciado, o repo é público
- Criar CSS separado para as páginas do blog (cada uma é self-contained). Os
  temas do painel são a exceção, e só redefinem tokens de cor
- Editar `index.html` à mão para adicionar um card — o manifest controla isso
- Publicar sem o cache-busting (`meta.version` nos dois manifests + `?v=` no
  index)
- Chapar um valor padrão no código — o padrão é seed no banco
- Afrouxar o CORS para testar local — as páginas detectam `file://`/localhost
  e rodam contra mocks
- Adicionar um tema sem registrá-lo nos **quatro** lugares (os dois `.css`,
  `VALIDOS` em `tema.js`, `TEMAS` em `temas.js`)
- Pedir ou gravar a **service role key** em qualquer arquivo do repositório
- Assumir qualquer coisa sobre um arquivo sem lê-lo primeiro

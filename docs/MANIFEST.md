# MANIFEST.md — Schema e Instruções

## Arquivos de manifest

**`assets/js/manifest.js`** — **arquivo ativo**. Carregado via `<script>` no `index.html`, seta `window.PSYCHES_MANIFEST`. Funciona em `file://` e HTTP. Este é o arquivo que você edita ao adicionar entradas.

**`manifest.json`** (raiz) — cópia de referência em JSON puro. Mantenha sincronizado com `assets/js/manifest.js` quando fizer alterações. Útil para validação e documentação.

### Sintaxe de redação

Qualquer campo string pode conter trechos marcados com `#(texto)`. Esses trechos são exibidos embaralhados no index via `redact.js`.

```
"subtitle": "#(trecho secreto) — parte que aparece normal"
"subtitle": "#(tudo redactado)"
```

O embaralhamento ocorre no carregamento da página. Cada reload mostra caracteres diferentes. O texto original existe no HTML source (sem criptografia — é barreira visual intencional).

Nenhum renderizador faz fetch — os dois leem `window.PSYCHES_MANIFEST` direto:
`index.html` pelo script inline no próprio arquivo, `legacy.html` por
`assets/js/index.js`. Nenhuma entrada existe no site sem estar no `manifest.js`.

---

## Schema de uma entrada

```json
{
  "slug": "retrato",
  "file": "pages/retrato.html",
  "title": "Retrato em alta resolução",
  "subtitle": "Mapa de quem é, pelo que registra",
  "categories": ["Identidade", "Autoconhecimento"],
  "tags": ["Observador", "Professor", "Amante", "LifeOS", "Jung"],
  "icon": "🪞",
  "date": "2026-04",
  "date_display": "Abril 2026",
  "volume": 1,
  "protected": false,
  "theme": "identidade",
  "status": "published"
}
```

### Campos obrigatórios

| Campo | Tipo | Descrição |
|---|---|---|
| `slug` | string | identificador único, sem espaços, sem acentos |
| `file` | string | caminho a partir da raiz, **com o prefixo `pages/`** (ex.: `pages/retrato.html`) |
| `title` | string | título em itálico na tipografia editorial |
| `subtitle` | string | frase descritiva curta |
| `categories` | array | 1–3 categorias temáticas (aparecem no topo do card) |
| `tags` | array | palavras-chave (aparecem como badges no card) |
| `icon` | string | emoji único que representa a entrada |
| `date` | string | formato ISO parcial: `"YYYY-MM"` ou `"YYYY-MM-DD"` |
| `date_display` | string | formato legível para exibição: `"Abril 2026"` |
| `volume` | number | número do volume ao qual pertence (1, 2, 3...). `null` ou ausente = **invisível no index** |
| `protected` | boolean | anotação informativa — **nenhum renderizador lê este campo** (ver abaixo) |
| `theme` | string | define a cor da barra lateral do card (ver VISUAL.md) |
| `status` | string | `"published"` ou `"draft"` (drafts não aparecem no index) |

### `protected` não protege nada

O campo existe no schema mas não é lido por `index.html` nem por
`assets/js/index.js`. O card é renderizado exatamente igual nos dois casos — sem
cadeado, sem filtro, sem aviso. A proteção real de uma página vem do `<script>`
que ela carrega no `<head>` (`gate.js` ou `access-gate.js`).

Hoje o campo está dessincronizado da realidade em 5 entradas — ver
[`AUTH.md`](AUTH.md#o-campo-protected-do-manifest) para a lista.

### Valores válidos para `theme`

A cor real de cada barra vem do mapa `THEME_ACCENTS` em `index.html` (script inline) e é espelhada em `assets/js/index.js` (usado por `legacy.html`). Ao criar um theme novo, adicionar a chave nos dois lugares — e no legend de `admin/index.html`.

```
"identidade"   → #8b3a3a — vermelho terroso
"psicodelia"   → #3a5c8b — azul
"metodo"       → #3a7a5c — verde
"ciencia"      → #7a5c3a — marrom dourado
"sombra"       → #c44a3f — vermelho-alaranjado (mais vívido)
"persona"      → #5a6b7a — azul-acinzentado
"umwelt"       → #38408b — azul índigo
"onirico"      → #5c3a8b — violeta
"eros"         → #8b3a6b — rosa-magenta
"vestigio"     → #2f7d8b — verde-azulado (teal)
```

Se a entrada não se encaixa em nenhum (valor ausente, `null`, ou string que não bate com nenhuma chave acima), cai no fallback `"identidade"` (vermelho) — silenciosamente, sem erro. Antes de escrever um valor de `theme` novo no manifest, confira essa lista (ou o legend visual em `/admin`) para não cair no fallback por acidente.

#### Entradas hoje no fallback por engano

Sete entradas carregam valores que não existem no mapa e portanto aparecem
vermelhas sem que ninguém tenha escolhido isso:

| `theme` escrito | Entradas |
|---|---|
| `"default"` | `tarot-temenos-sincronicidade`, `a-alavanca-e-a-fronteira`, `manifesto-terrorismo-psicodelico` |
| `"dark"` | `sonhos-teatro-do-ego`, `planejamento-financeiro` |
| `"custom"` | `sete-leituras-manifesto` |
| `null` | `do-zero-ao-pleno` |

É o mesmo problema que já aconteceu com `"umwelt"` e foi corrigido (ver a nota no
legend do `/admin`). `"vestigio"` é o caminho inverso: está no mapa, mas nenhuma
entrada usa.

---

## Estado atual do manifest

Este arquivo **não** duplica o conteúdo do manifest — a fonte de verdade é
`assets/js/manifest.js`, espelhada em `manifest.json`. Leia de lá. O resumo
abaixo existe só para você conferir de relance se a contagem bate.

| | |
|---|---|
| Entradas | 27, todas `status: "published"` (nenhum draft) |
| `meta.current_volume` | 3 |
| `meta.entries_per_volume` | 10 |
| Distribuição | Vol. 1: 10 · Vol. 2: 10 · Vol. 3: 7 |
| `meta.version` | `"20260826-1000"` (cache-busting, ver abaixo) |

Para conferir a qualquer momento:

```bash
node -e "const j=require('./manifest.json');
const c={}; j.entries.filter(e=>e.status==='published').forEach(e=>c[e.volume]=(c[e.volume]||0)+1);
console.log(j.entries.length,'entradas', c, 'vol atual:', j.meta.current_volume)"
```

### Os dois arquivos precisam bater

`manifest.json` é espelho exato de `assets/js/manifest.js` — mesmos slugs, mesma
ordem, mesmo `meta`. Sem entradas de teste em nenhum dos dois. Para verificar:

```bash
node -e "const fs=require('fs');
const j=require('./manifest.json');
const js=JSON.parse(fs.readFileSync('assets/js/manifest.js','utf8').match(/=\s*(\{[\s\S]*\});?\s*$/)[1]);
const a=j.entries.map(e=>e.slug).join(','), b=js.entries.map(e=>e.slug).join(',');
console.log(a===b && JSON.stringify(j.meta)===JSON.stringify(js.meta) ? 'OK' : 'DESSINCRONIZADO')"
```

---

## Como adicionar uma nova entrada

1. Cria o arquivo `.html` da entrada **em `pages/`**
2. Abre `assets/js/manifest.js` — este é o arquivo que o site lê
3. Adiciona o objeto da entrada no array `entries` (ordem cronológica, mais
   recente por último), com `"file": "pages/<slug>.html"`
4. Determina o `volume`: conta as entradas `published` no `meta.current_volume`.
   Se já houver `entries_per_volume` (10), a nova entra no volume seguinte e
   `meta.current_volume` é incrementado. **Nunca deixa `volume` como `null`** —
   entrada sem volume não aparece no index
5. Confere o `theme` contra a lista de valores válidos acima — valor errado cai
   no fallback vermelho sem erro nenhum
6. Replica a mesma entrada em `manifest.json` (espelho exato)
7. Faz o cache-busting (abaixo) — sem isso o GitHub Pages serve o manifest antigo
   por até 10 minutos
8. Roda os dois snippets de verificação da seção anterior

## Cache-busting — obrigatório ao mexer no manifest

Bump da versão em **três lugares ao mesmo tempo**:

1. `assets/js/manifest.js` → campo `version` no `meta`
2. `manifest.json` → mesmo campo `version` no `meta`
3. `index.html` → query string `?v=` nas tags `<script>` de
   `assets/js/manifest.js` e `assets/js/redact.js`

`legacy.html` tem o seu próprio conjunto de `?v=` (quatro scripts:
`manifest.js`, `index.js`, `redact.js`, `back-to-top.js`) e hoje está numa versão
diferente da do `index.html` — atualize também se mexer nele.

## Entradas protegidas

`protected: true` **não** ativa proteção nenhuma (ver a seção sobre o campo, mais
acima). Para proteger de fato, adicione o `<script>` do gate no `<head>` da
página — lê [`AUTH.md`](AUTH.md) para escolher entre `gate.js` (senha) e
`access-gate.js` (origem de navegação).

# EXPANDING_PAGES.md — Páginas Expansíveis

## O que são

Algumas páginas do Archive não são entradas fechadas (mapas de um momento
específico), mas documentos vivos que crescem com o tempo. O caso real hoje é
`pages/o-observador.html`, que ganha um bloco novo a cada post publicado no
perfil `qui_videti`.

Essas páginas têm a mesma estética das entradas normais, mas seguem um padrão
diferente de atualização: **o conteúdo é acrescentado, não reescrito**.

---

## Como identificar

Pela estrutura da página, não por metadado.

> **Não existe campo `expanding` no manifest.** Versões anteriores deste doc
> mandavam marcar `"expanding": true` — esse campo nunca foi implementado, não
> está em nenhuma entrada e não é lido por renderizador nenhum. Não adicione.

Uma página expansível é reconhecida por ter uma seção de blocos repetíveis
numerados sob um `<h2>` do tipo "Post a post" / "Registros".

---

## Estrutura interna real (`pages/o-observador.html`)

O bloco repetível é `.post-card`, e cada um é autocontido:

```html
<h2>Post a post — o que foi <em>feito</em> e o que foi <em>aprendido</em></h2>

<!-- POST #1 -->
<div class="post-card">
  <div class="post-header">
    <span class="post-number">#1</span>
    <span class="post-date">23/03/2026</span>
  </div>
  <h3>🌵 Lemon Wachuma Tek — Alquimia Ácida</h3>
  <div class="post-pilar tecnica">⚗️ Alquimia &amp; Extrações · Prompt #1 Hermético</div>
  <div class="post-body">
    <p>[O que foi feito — descrição do conteúdo publicado.]</p>
    <p>[A decisão central / o que foi aprendido.]</p>
  </div>
  <div class="post-frase">"[Frase de destaque do post]"</div>
  <div class="post-tags">
    <span class="tag">mescalina</span>
    <span class="tag">5-HT2A</span>
  </div>
</div>
```

CSS (vive no `<style>` da própria página, como todo o resto do projeto):

```css
.post-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 32px;
  margin: 24px 0;
  transition: border-color 0.3s, background 0.3s;
}
```

A classe modificadora no `.post-pilar` define a cor do eixo de conteúdo. Três
existem hoje — reutilize antes de inventar uma quarta:

| Classe | Eixo |
|---|---|
| `tecnica` | ⚗️ Alquimia & Extrações |
| `natureza` | conteúdo de natureza / campo |
| `relato` | relato em primeira pessoa |

---

## Fluxo de atualização

1. Recebe o novo conteúdo (via contexto ou leitura de chat)
2. Abre `pages/o-observador.html`
3. Localiza a seção "Post a post"
4. Adiciona um novo `<div class="post-card">` **no fim da lista** — a ordem ali é
   cronológica crescente (`#1` é o mais antigo), ao contrário do index
5. Numera o `.post-number` seguindo o último (`#6` → `#7`)
6. Reutiliza uma classe de `.post-pilar` já existente, se couber
7. **Não** altera o header, o subtítulo, nem o diagrama principal da página
8. **Não** mexe no manifest — a entrada já existe, apenas cresceu. Nem `date`,
   nem `date_display`: eles marcam a criação da página, não o último post

---

## Relação com `qui-videti/`

`pages/o-observador.html` é a **análise** do perfil — o que cada post fez e o que
ensinou. `qui-videti/` é o **arquivo dos posts em si**, um diretório por post
(`post-1/` … `post-6/`), cada um com seu `index.html` e sua pasta `images/`.

São duas coisas separadas, e as duas crescem juntas: um post novo normalmente
significa um `.post-card` novo em `o-observador.html` **e** um `post-N/` novo em
`qui-videti/` (mais o card correspondente em `qui-videti/index.html`). Confirme
qual dos dois lados o pedido cobre antes de assumir que é os dois.

**Estado atual (set/2026): os dois lados estão dessincronizados.**
`qui-videti/` tem 6 posts (`post-1` a `post-6`, todos com card no
`qui-videti/index.html`), mas `o-observador.html` tem só 5 `.post-card` — falta
o bloco do **post-6, "Imaginação Ativa"**. Se for atualizar a página, é esse o
próximo a entrar, como `#6`.

---

## Quando o diagrama principal existe

Páginas expansíveis podem ter um diagrama Mermaid no topo representando a
estrutura geral. Esse diagrama só é atualizado quando a estrutura *fundamental*
muda, não a cada novo registro. Se em dúvida, não altera o diagrama — pergunta
antes.

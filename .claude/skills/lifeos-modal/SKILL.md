---
name: lifeos-modal
description: Cria um modal do LifeOS no padrão banner `.pdet-*` — formulário de criar/editar, tela de detalhe só leitura, ou lista com CRUD dentro — com abrir/fechar, ESC, clique fora, validação, mapa de erros, loading e exclusão de dois cliques. Use sempre que um pedido envolver "formulário", "editar X", "tela de detalhe", "botão de excluir" ou qualquer janela sobreposta no LifeOS. Trigger - /lifeos-modal
---

# /lifeos-modal

Todo modal do LifeOS é o mesmo componente: um banner com ícone no topo, o nome
em Playfair itálico, e o corpo. O que muda é o conteúdo.

Exemplos:
- **formulário simples** — `#memoria-modal` em `lifeos/memoria.html` +
  `openMemoriaModal`/`onMemoriaSubmit` em `memoria.js` (a referência)
- **detalhe só leitura com ações** — `#detail-modal` e
  `#projeto-detail-modal` no hub
- **lista + formulário no mesmo modal** — `#citacoes-modal` no hub
- **pickers de chip** (status/tipo/projeto) — `#tarefa-modal` no hub

---

## 1. Markup

```html
<!-- ───────────────── MODAL · <NOME> (criar/editar) ───────────────── -->
<div id="<x>-modal" class="modal" role="dialog" aria-modal="true">
  <div class="modal-panel">
    <div class="pdet-banner">
      <button type="button" class="pdet-close" id="<x>-modal-close" aria-label="Fechar"><i class="fad fa-times"></i></button>
      <div class="pdet-banner-icon"><i class="fad fa-<icone-do-dominio>"></i></div>
    </div>
    <div class="modal-body">
      <div class="pdet-head"><div class="pdet-name" id="<x>-modal-title">Novo <x></div></div>
      <div class="pdet-body-pad">
        <form id="<x>-form" autocomplete="off">
          <div class="edit-field">
            <label class="edit-label" for="<x>-<campo>">Campo <span class="edit-count" id="<x>-<campo>-count"></span></label>
            <input id="<x>-<campo>" class="edit-input" type="text" maxlength="<MAX>" spellcheck="false">
            <div class="edit-hint">Uma frase dizendo o que vai aqui, se não for óbvio.</div>
          </div>
          <div id="<x>-error" class="edit-error"></div>
          <div class="edit-actions">
            <button type="button" id="<x>-cancel" class="edit-btn edit-btn-ghost">Cancelar</button>
            <button type="submit" id="<x>-save" class="edit-btn edit-btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>
```

- No hub, o painel leva também `pdet-panel` (e `edit-panel` nos de
  formulário) — copie a classe dos modais vizinhos do mesmo arquivo.
- O modal nasce **fechado** pela classe (`.modal` sem `.open`), não por
  `hidden` — a transição de opacidade depende disso.
- Campos: `input.edit-input`, `select.edit-input`, `textarea.edit-input`
  (`.prose` quando o conteúdo é texto corrido, em EB Garamond). Contador de
  caracteres com `.edit-count` (+ `.over` passando do limite) em campo com
  limite apertado.
- Lista fechada de valores (status, tipo, tag) é **picker de chips**
  (`.chip-opt` / `.is-selected`), não `<select>` — copie `buildChipOptions`,
  `setSingleChip`, `setMultiChips` e `toggleMultiChip` de `lifeos.js` ou
  `tarefas.js` (e `buildProjetoChipPicker` para vínculo a projeto), e
  reconstrua quando o vocabulário chegar.
- Markdown: textarea com toggle editar/pré-visualizar (ver o campo descrição
  do `#tarefa-modal`), renderizado pela `renderMarkdown()` do próprio arquivo
  — `marked` com fallback para texto escapado se o CDN falhar.
- Cor do banner: o padrão é o gradiente com `--gold`. Detalhe de algo que tem
  cor própria (status do projeto) passa a cor por uma variável CSS no painel
  (`--pdet-accent`), nunca por hex no CSS.

## 2. JS — abrir, fechar, salvar

```js
function open<X>Modal(id) {
  var obj = id ? achar<X>(id) : null;
  EDIT_<X>_ID = obj ? obj.id : null;
  $('<x>-modal-title').textContent = obj ? 'Editar <x>' : 'Novo <x>';
  $('<x>-<campo>').value = obj ? obj.<campo> : '';
  $('<x>-error').textContent = '';
  $('<x>-modal').classList.add('open');
  $('<x>-<campo>').focus();
}

function close<X>Modal() {
  $('<x>-modal').classList.remove('open');
  EDIT_<X>_ID = null;
}

function on<X>Submit(e) {
  e.preventDefault();
  var errEl = $('<x>-error'); errEl.textContent = '';
  var campo = $('<x>-<campo>').value.trim();
  if (!campo) { errEl.textContent = 'defina um <campo>'; $('<x>-<campo>').focus(); return; }

  /* Guardado ANTES do close — close zera EDIT_<X>_ID (LIFEOS.md §9). */
  var editandoId = EDIT_<X>_ID;
  var req = editandoId ? api.update(editandoId, { <campo>: campo }) : api.create({ <campo>: campo });

  $('<x>-save').disabled = true;
  setLoading(true);
  req.then(function (data) {
    setLoading(false); $('<x>-save').disabled = false;
    close<X>Modal();
    /* atualiza o array em memória (ou reload()) e re-renderiza */
  }).catch(function (err) {
    setLoading(false); $('<x>-save').disabled = false;
    errEl.textContent = msgErro(err);
    console.error('[<pagina>] salvar <x>', err);
  });
}
```

Regras que não são estilo — cada uma já foi um bug:

- **`var editandoId = EDIT_<X>_ID` antes de `close<X>Modal()`.** Checar o
  global depois do close sempre lê `null` e a edição vira uma criação
  duplicada.
- Validação no front é conveniência; a de verdade é da Edge Function. Os
  limites (`maxlength`, `MAX_*`) são **cópia** dos de lá.
- Erro vira mensagem legível pelo mapa `ERRO` (`{ codigo: 'mensagem' }`),
  nunca o código cru na tela. Código sem entrada no mapa mostra
  `'erro — ' + codigo`.
- O botão de salvar fica `disabled` durante a requisição (clique duplo cria
  duas linhas).
- Editando um registro cujo valor de vocabulário saiu da lista, **mantenha o
  valor atual como opção** — senão salvar troca o valor sem ninguém pedir (ver
  `fillCategoriaSelect` em `memoria.js`).
- No hub, depois de escrever: mutar o array, `writeHubCache()`, re-render da
  seção. Nas páginas: `reload()` ou mutação + render.

Listeners no `init()`:

```js
$('<x>-form').addEventListener('submit', on<X>Submit);
$('<x>-cancel').addEventListener('click', close<X>Modal);
$('<x>-modal-close').addEventListener('click', close<X>Modal);
$('<x>-modal').addEventListener('click', function (e) { if (e.target === $('<x>-modal')) close<X>Modal(); });
```

E o modal entra no handler de ESC da página, **na ordem de empilhamento**: o
que abre por cima fecha primeiro. No hub, o drawer é checado antes de
qualquer modal. Todo `close<X>Modal()` entra no `onLogout()`.

**Nunca dois modais abertos ao mesmo tempo.** Ir do detalhe para o editar
fecha um e abre o outro.

## 3. Detalhe só leitura

Mesmo banner; o corpo mostra os campos com tags (`.tag-*`) e o texto
renderizado. Ações (Editar/Excluir) ficam num rodapé ou como icon-buttons ao
lado do fechar (`.pdet-banner-top-actions`, reusando `.pdet-close`) — veja qual
dos dois o arquivo já usa e siga o mesmo. Não duplique uma ação que já existe
na linha da lista.

## 4. Excluir — dois cliques, sem `confirm()`

Nunca `window.confirm()`. O padrão é o botão que vira "confirmar" e executa
no segundo clique (`LIFEOS.md` §7). Copie `resetDeletePending` +
`confirmDelete` do arquivo que você está editando; se ele ainda não tem,
copie de `memoria.js`:

```js
function confirmDelete(btn, key, run) {
  if (DELETE_PENDING !== key) {
    resetDeletePending();
    DELETE_PENDING = key;
    btn.classList.add('pending');
    btn.innerHTML = '<i class="fad fa-check"></i>';
    return;
  }
  resetDeletePending();
  setLoading(true);
  run().then(function () { setLoading(false); /* atualizar e re-renderizar */ })
    .catch(function (err) { setLoading(false); /* mensagem via msgErro */ });
}
```

- A `key` identifica o alvo (`'m:' + id`), para um segundo clique em outra
  linha não confirmar a primeira.
- Um listener em `document` que cancela a pendência ao clicar fora **usa
  `e.composedPath()`**, nunca `e.target.closest()` — o `<i>` clicado some do
  DOM quando o botão troca de conteúdo, e o `closest` desfaz a confirmação no
  mesmo clique.
- Erro de integridade (`409 has_tarefas`) tem mensagem própria no mapa
  `ERRO`, explicando o que impede a exclusão.
- ESC e re-render cancelam a pendência.

## 5. Fechamento

- `?v=` do JS sobe.
- Diga ao usuário o que testar em `file://`: criar, editar, erro de
  validação, excluir (um clique não apaga; o segundo sim), ESC, clique fora.
- `/lifeos-revisar`.

## Nunca

- `window.confirm`/`alert`/`prompt` para fluxo normal
- `hidden` para abrir/fechar modal (é a classe `.open`)
- Checar o id de edição depois de fechar o modal
- Modal sem banner, ou com outro visual de cabeçalho
- `innerHTML` com dado do banco sem `esc()`

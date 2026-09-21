# Temas do LifeOS

Cada `.css` aqui redefine os tokens de cor do LifeOS. Um tema **não** muda
layout, espaçamento ou tipografia — só a paleta.

## Como funciona

As páginas do LifeOS trazem a paleta padrão num bloco `SYSTEM SKIN` no fim do
`<style>` inline. O `<link>` do tema entra **depois** desse `<style>` no `<head>`,
então vence por ordem do documento (mesma especificidade, `:root`).

O `<link>` é escrito por um bootstrap inline minúsculo no topo do `<head>`
(`assets/js/tema.js` é carregado *antes* de qualquer render) — por isso não há
flash de tema errado.

Ordem de precedência:

1. `localStorage['lifeos_tema']` — escolha deste navegador, feita em `temas.html`
2. `LIFEOS_CONFIG.tema` — padrão da instância, em `assets/js/lifeos-config.js`
3. `sepia` — fallback embutido

## Criar um tema novo

1. Copia `sepia.css` para `<nome>.css`
2. Troca os valores (só os valores — não renomeie as variáveis)
3. Registra o tema em `TEMAS` no topo de `assets/js/temas.js`

**Todo tema precisa definir o conjunto inteiro de tokens.** Um token faltando
não cai num padrão: ele herda o valor do `SYSTEM SKIN` da página, e a mistura
das duas paletas costuma ficar pior que qualquer uma das duas.

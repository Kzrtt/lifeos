---
name: lifeos-vocabulario
description: Cria um domínio de vocabulário no LifeOS (lista de tags, status ou tipos editável em menu → Tags) ou torna configurável uma lista que hoje está chapada no código — seed na migration, ramos das RPCs de renomear/uso, mapa DOMINIOS, validação na Edge Function, fallback + carregarVocab nos fronts, enum no MCP, mock de Tags. Use sempre que um campo tiver um conjunto fechado de valores escolhidos pelo usuário. Trigger - /lifeos-vocabulario
---

# /lifeos-vocabulario

No LifeOS, **nenhuma lista de valores é constante de código.** Status, tipos e
tags vivem em `lifeos_vocabularios`, se editam em **menu → Tags**, e renomear
um valor migra os dados que o usam. As constantes no código existem só como
**fallback** para quando a leitura falha. Leia `docs/LIFEOS.md` §14.

Um domínio atravessa muitos arquivos, e a divergência é silenciosa: o
seletor mostra um valor que a Edge Function recusa, ou a IA recebe um `enum`
diferente do que a validação aceita. Siga a lista inteira.

---

## 1. Defina o domínio

- **Nome** `<entidade>_<campo>` em snake_case (`tarefa_status`,
  `memoria_categoria`).
- **Coluna** que ele alimenta, e se é **escalar** (`text`) ou **array**
  (`text[]`).
- **Tem cor?** Só se a interface pinta por valor (hoje só `evento_tipo`).
- **Valores iniciais** e ordem.
- **Algum valor é lido pela lógica pelo nome?** (o status "concluído", o
  "Crédito" da regra de fatura). Esses são `protegido = true`: podem ser
  renomeados, não apagados.

## 2. Migration (nova, próxima da sequência)

```sql
insert into public.lifeos_vocabularios (dominio, valor, cor, ordem, protegido)
values
  ('<dominio>', '<Valor A>', null, 10, false),
  ('<dominio>', '<Valor B>', null, 20, true)
on conflict (dominio, valor) do nothing;
```

E as **duas RPCs reescritas por inteiro** com o ramo novo —
`create or replace` não aceita "só um ramo a mais":

- `lifeos_renomear_vocabulario` — `update … set <coluna> = p_para where
  <coluna> = p_de` (escalar) ou `array_replace(<coluna>, p_de, p_para) where
  p_de = any(<coluna>)` (array)
- `lifeos_uso_vocabulario` — `count(*)` com o mesmo critério

**Parta da versão mais recente das funções**, não da `0002`: procure a última
migration que as redefine
(`grep -l "function public.lifeos_renomear_vocabulario" supabase/migrations/*`)
e copie o corpo dela, acrescentando o ramo. Mantenha os `revoke`/`grant` do
fim (só `service_role` executa).

## 3. Os lugares no código

| # | Onde | O quê |
|---|---|---|
| 1 | `supabase/functions/lifeos-vocabularios/index.ts` | entrada em `DOMINIOS`: `rotulo` (como aparece em Tags), `tabela`, `coluna`, `array`, `cor` |
| 2 | `assets/js/tags.js` | o mock local (`MOCK_DOM` + `MOCK_VOCAB`) é uma **amostra**, um domínio de cada formato (array, escalar, com cor, com protegido). Só acrescente o novo se ele trouxer um formato que a amostra não tem |
| 3 | Edge Function do domínio | valida o valor contra a tabela, com fallback embutido — molde `fetchCategorias()` em `lifeos-memorias`. Array: todos os itens precisam existir |
| 4 | cada JS que mostra ou escolhe o valor | constante de fallback + linha no `carregarVocab` (`X = aplicar('<dominio>', X);`) + **reconstruir os pickers no `.then`** |
| 5 | `supabase/functions/lifeos-mcp/index.ts` | chave no `FALLBACK`; `enum: VOCAB.<dominio>` em toda propriedade de tool que usa o campo; validação no handler contra `VOCAB.<dominio>` |
| 6 | `docs/LIFEOS.md` §14 | linha na tabela "Os N domínios" (e o número no título) |

Detalhes que já viraram bug:

- **Picker montado no `init()` não vê o vocabulário** — o `init()` roda antes
  de `carregarVocab`. Todo seletor montado a partir da lista é chamado de novo
  no `.then` dele (ver o fim de `carregarVocab` em `lifeos.js`).
- **Cor por posição, não por nome.** Onde a cor depende do valor (status →
  neutro/dourado/verde), o mapa é remontado por índice no `carregarVocab`
  (`TAR_STATUS_COR`), para sobreviver a um rename.
- **Nunca compare com o texto literal** de um valor protegido. "Está
  concluída?" é `status === statusConcluido(lista)` (o último da lista), não
  `=== 'Feito'`.
- Filtro com valor padrão por nome (`PROJ_STATUS_FILTRO`) cai no primeiro
  disponível se o nome sumiu da lista.
- Editando um registro cujo valor saiu do vocabulário, o seletor **mantém o
  valor atual** como opção — senão salvar troca o valor sem ninguém pedir.
- No MCP, `buildTools()` é função justamente para o `enum` sair do `VOCAB`
  carregado a cada chamada. Nunca congele a lista numa constante de módulo.

## 4. Transformar uma lista chapada em vocabulário

Quando a lista já existe no código (constante no JS, `CHECK` no banco):

1. Migration: `alter table … drop constraint <check>` + seed com os valores
   **exatamente como estão hoje nos dados** (confira com
   `select distinct <coluna> …` — peça ao usuário para rodar, ou use o MCP do
   Supabase se estiver conectado).
2. Os seis lugares acima. A constante que já existia vira o fallback.

## 5. Fechamento

- Deploy de `lifeos-vocabularios`, da function do domínio e de `lifeos-mcp`
  (pergunte antes).
- `?v=` de cada JS alterado.
- Diga ao usuário o que conferir: o domínio aparece em Tags; renomear um valor
  em uso mostra quantas linhas migraram; o seletor da tela do módulo mostra o
  nome novo sem recarregar duas vezes; excluir um valor em uso fica
  bloqueado.
- `/lifeos-revisar`.

## Nunca

- `CHECK (<coluna> in (...))` no banco
- Lista de valores só no JS, sem domínio
- Reescrever as RPCs a partir de uma versão antiga (perde ramos de outros
  domínios)
- Comparar com o texto de um valor protegido

---
name: lifeos-mcp-tool
description: Cria ou altera uma tool do servidor MCP do LifeOS (`supabase/functions/lifeos-mcp/index.ts`) — schema em buildTools() com enum do vocabulário, handler com erros legíveis pelo modelo, busca por nome em vez de id, aviso de truncamento, sem DELETE — e propaga para a tela do MCP, a apresentação e os docs. Use para "deixar a IA ler/criar/editar X", "tool nova no MCP", ou quando um módulo ou campo novo precisar chegar à IA. Trigger - /lifeos-mcp-tool
---

# /lifeos-mcp-tool

O servidor MCP é como qualquer IA conectada lê e escreve no LifeOS. Uma tool
é usada **por um modelo**, que erra de jeitos previsíveis — cada regra abaixo
fecha um desses erros. Ver `docs/LIFEOS.md` §13/§17 e o cabeçalho de
`lifeos-mcp/index.ts`.

Tools de referência no arquivo:
- leitura simples: `search_citacoes` / `handleSearchCitacoes`
- leitura com filtro por projeto: `search_tarefas`
- escrita com patch parcial: `update_tarefa`
- escrita com substituição completa (texto longo): `update_nota`,
  `update_registro`
- resolução por nome com ambiguidade: `resolveMemoria`, `resolveProjetoFiltro`

---

## 1. Desenhe a tool

- **Nome** `verbo_dominio` em snake_case: `search_*`, `create_*`, `update_*`,
  `list_*`, `get_*`, ou um verbo específico quando a operação é outra
  (`add_registro`, `resumo_financeiro`).
- **Nunca `delete_*`.** Excluir é só pelas telas — uma IA que erra uma edição
  deixa algo para corrigir; uma que apaga, não.
- **Leitura ou escrita.** Escrita em domínio novo é decisão do usuário —
  pergunte se o pedido não disse.
- **Edição de texto longo** (conteúdo de nota, fato da memória): substituição
  completa, o modelo reenvia o texto inteiro. **Edição de campos curtos**:
  patch parcial, só muda o que veio.

## 2. Schema — em `buildTools()`

```ts
{
  name: "search_<dominio>",
  description:
    "O que a tool faz, em uma ou duas frases, do ponto de vista de quem " +
    "vai chamar. Quais filtros existem e como combinam (AND entre filtros, " +
    "OR dentro de um array). O que volta, e o que acontece sem filtro.",
  inputSchema: {
    type: "object",
    properties: {
      nome:   { type: "string", description: "Trecho do nome (não precisa ser exato)." },
      status: { type: "string", enum: VOCAB.<dominio>_status, description: "Status exato." },
      limit:  { type: "integer", description: "Máximo de resultados (padrão 20, máximo 50)." },
    },
    required: [/* só o que é de fato obrigatório */],
  },
},
```

- A `description` é o **manual do modelo**: formato de data (`AAAA-MM-DD`),
  unidade, o que é opcional, efeito colateral ("passa a concorrer ao sorteio
  do banner"). Em português, como as outras.
- Todo campo de vocabulário tem `enum: VOCAB.<dominio>` — **nunca** uma lista
  literal. `buildTools()` é função justamente para isso.
- Referência a outra entidade é **por nome** (`projeto: "casa"`), não por id —
  o modelo não sabe ids.

## 3. Handler

```ts
// ── Tool: search_<dominio> ────────────────────────────────────────────────
async function handleSearch<Dominio>(REST: string, headers: Record<string, string>, args: Record<string, any>) {
  const limit = clampLimit(args?.limit);
  // … busca no PostgREST com a service role (REST + headers) …
  // … filtros …
  return toolText(JSON.stringify({
    total_matches: total, returned: lista.length, truncated: total > lista.length, <plural>: lista,
  }, null, 2));
}
```

- **Erro de domínio é resposta, não exceção:** `return toolText("Projeto
  'xyz' não encontrado. Projetos existentes: A, B, C.", true)`. O modelo lê o
  motivo e se corrige na chamada seguinte. Exceção (`throw`) fica para falha
  de infraestrutura.
- A mensagem de erro diz **como acertar**: os valores válidos, o nome parecido,
  o formato esperado.
- Nome que bate com mais de uma entidade: não escolha — devolva as opções.
- Toda busca devolve `total_matches`, `returned` e `truncated`, para o modelo
  não tomar metade por tudo. Limite com `clampLimit` (padrão 20, máximo 50).
- Escrita devolve o objeto criado/alterado, já no formato de leitura.
- **Validação e limites são cópia** dos da Edge Function do domínio
  (`MAX_*`), com um comentário dizendo de onde vieram. O MCP fala direto com o
  PostgREST, não passa pela function — regra que só existe lá não vale aqui.
- Datas relativas a "hoje" usam `todayInSaoPaulo()`.
- Regra de negócio que a tela aplica (fatura, saldo) é **copiada inteira** —
  o modelo somando linhas cruas responde errado com confiança. Ver
  `resumo_financeiro` e `docs/FINANCAS.md` §9.1.
- Cabeçalho `// ── Tool: <nome> ───` antes da função, como as outras.

Registre no mapa `handlers` dentro de `tools/call`, na mesma posição relativa
da lista de `buildTools()`.

## 4. Propagar

| Onde | O quê |
|---|---|
| `serverInfo.version` em `lifeos-mcp/index.ts` | sobe o minor (tool nova) ou o patch (ajuste) |
| `assets/js/mcp.js` | entrada na lista de tools (`nome`, `tipo: 'leitura'`/`'escrita'`, `desc`, `filtros`) na mesma ordem — é cópia, a tela não lê do servidor |
| `lifeos/index.html` (apresentação) | a contagem de ferramentas aparece em vários pontos (boot, §04, conversa ilustrativa, diagrama) e a tool entra na lista por domínio (`.tl`) — procure pelo número atual |
| `docs/LIFEOS.md` §13 | contagem de tools; a seção do módulo, se a tool for dele |
| `docs/AUTH.md` | a lista de tools de consulta/escrita do MCP, se a tool mudar essa lista |

Se a tool nasce junto com uma memória nova ou muda o que a IA deve saber ao
conectar, reveja `buildInstructions()`.

## 5. Deploy e teste

Pergunte antes de deployar (publica em produção):

```bash
supabase functions deploy lifeos-mcp --no-verify-jwt
```

Teste com JSON-RPC direto (a URL completa, com o token, está em **menu → MCP**
— peça ao usuário para rodar, não peça o token no chat):

```bash
curl -s "$MCP_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
curl -s "$MCP_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<tool>","arguments":{}}}'
```

Confira também um caso de erro de domínio: ele volta com `isError: true` e
texto legível, não como erro JSON-RPC.

## Nunca

- Tool de DELETE
- `enum` literal onde existe vocabulário
- Pedir id quando dá para resolver por nome
- Lista truncada sem `truncated: true`
- Limite ou regra diferente da Edge Function do domínio
- Esquecer `mcp.js` e a apresentação (a tela diz uma coisa, o servidor faz
  outra)

---
name: lifeos-modulo
description: Planeja e constrói um módulo novo do LifeOS de ponta a ponta — decide o padrão (página própria, nativo do hub ou híbrido), e encadeia backend, vocabulários, tela, hub, menu, MCP e docs na ordem certa, chamando as skills lifeos-* de cada etapa. Use quando o pedido for uma área nova da vida para gerenciar ("quero controlar hábitos", "um módulo de leituras", "registrar treinos"), não um ajuste num módulo existente. Trigger - /lifeos-modulo
---

# /lifeos-modulo

Um módulo é um tipo de dado novo com casa própria no LifeOS: tabela, Edge
Function, uma forma de ver e escrever, e (quase sempre) acesso pela IA. Esta
skill não repete o conteúdo das outras — ela **decide** e **ordena**.

Leia antes: `docs/LIFEOS.md` §1 (os padrões de módulo), §2 (isolamento) e §8
(como plugar um módulo). Olhe como um módulo parecido com o pedido foi feito.

---

## 1. Entrevista curta

Uma mensagem, com um padrão proposto em cada pergunta — o usuário deve poder
aceitar tudo com um "ok":

1. **O que se registra?** Uma frase, e os campos (nome, tipo, obrigatório).
2. **Com que frequência se consulta e escreve?** Todo dia → hub. Às vezes,
   com análise → página própria.
3. **Tem listas de valores?** (status, tipo, categoria) → vocabulários.
4. **Liga a projetos?** Nenhum / um / vários.
5. **A IA deve ler? Escrever?** (padrão: ler e criar; editar se o dado for
   curto; nunca excluir)
6. **Tem gráfico, total, evolução?** O que o usuário quer *ver* do dado.

Não comece a escrever código antes da resposta.

## 2. Escolha o padrão

| Padrão | Quando | Exemplo |
|---|---|---|
| **Nativo do hub** | poucos campos, uso diário, uma lista ou um formulário bastam | Citações, Eventos |
| **Página própria** (+ resumo só leitura no hub) | várias views, filtros, gráficos, regra de negócio | Finanças, Notas |
| **Híbrido** (página própria + CRUD no hub) | uso diário **e** análise | Tarefas |
| **Tela de contexto no drawer** | dado sobre o usuário ou o sistema, consultado de vez em quando | Memória |

Em dúvida, comece **nativo do hub**: promover para página própria depois é
natural; o contrário deixa uma página órfã. Apresente a escolha com o motivo
em uma linha e siga.

## 3. Plano

Escreva o plano como lista numerada, com a skill de cada passo, e mostre ao
usuário antes de executar:

1. `/lifeos-backend` — tabela `lifeos_<modulo>` + migration + Edge Function
2. `/lifeos-vocabulario` — um por lista de valores (se houver)
3. Interface, conforme o padrão:
   - nativo: `/lifeos-hero-section` (seção nova) + `/lifeos-modal`
   - página própria: `/lifeos-pagina` + `/lifeos-modal` + `/lifeos-hero-section`
     (resumo só leitura com "Abrir")
   - drawer: `/lifeos-pagina` + `/lifeos-menu`
4. `/lifeos-grafico` — para cada visualização pedida
5. `/lifeos-menu` — atalho no quicknav, se for de uso diário
6. `/lifeos-mcp-tool` — `search_<modulo>` e, se decidido, `create_`/`update_`
7. Docs (abaixo)
8. `/lifeos-revisar`

Execute na ordem: o front depende do contrato do backend, e o MCP depende do
vocabulário.

## 4. Docs do módulo

- `docs/LIFEOS.md`:
  - bloco de arquitetura da §2 (a linha do par HTML+JS, se houver página)
  - uma seção nova para o módulo: o que é, o padrão escolhido **e por quê**,
    tabela(s), Edge Function, o que fica no hub, o que a IA faz, o que ficou
    de fora de propósito
  - linha na tabela §10 "Status dos módulos"
  - §14 se nasceu vocabulário
- `docs/ARCHITECTURE.md` — árvore e contagens
- `SETUP.md` — function no loop de deploy
- `lifeos/tutorial.html` — o módulo na lista de módulos do guia
- `lifeos/index.html` (apresentação) — o módulo na grade de módulos e no
  "boot", se for um módulo de uso (não uma tela de config)

## 5. Escopo

Construa o que foi pedido e decidido na entrevista — nada de exportação, busca
avançada, arquivamento ou importação "porque vai precisar". Registre o que
ficou de fora na seção do doc ("O que não foi implementado"), como
`NOTAS.md` §7 faz.

## 6. Fechamento

Relatório final curto:
- o padrão escolhido e o motivo
- arquivos criados e alterados, por etapa
- **o que só o usuário pode fazer**: aplicar a migration, deployar as
  functions (com os comandos), testar no navegador
- o que ficou de fora, de propósito
- o resultado do `/lifeos-revisar`

## Nunca

- Misturar o módulo novo no arquivo ou na tabela de outro
- Página própria para algo que cabe numa seção do hub, sem motivo
- Pular a entrevista e inventar campos
- Tool de DELETE no MCP

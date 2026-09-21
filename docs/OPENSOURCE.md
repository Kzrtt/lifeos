# OPENSOURCE.md — o estado honesto deste repositório

Este arquivo existe para você decidir se quer instalar isto, sabendo o que
ainda dói. Nenhum projeto pessoal vira produto num passe — o que segue é o que
já está resolvido, o que ainda é atrito, e o que é dívida assumida.

Atualizado em **set/2026**, verificando cada afirmação contra o código.

---

## 1. O que funciona

O sistema **está em uso diário** na instância do autor, e é de lá que vieram as
capturas do README.

| | |
|---|---|
| Painel | 11 páginas — hub, finanças, tarefas, notas, e as 7 telas de configuração |
| Backend | 11 Edge Functions, 2 migrations, RLS sem policy (só `service_role`) |
| Temas | 9 paletas, cada uma em versão clara (blog) e escura (painel) |
| Arquivo público | capa paginada por volumes, galeria, publicação pelo próprio painel |
| Integrações | conector MCP para IA, webhook de lançamento por celular |

**Configurável de dentro de si mesmo.** Senhas, token do GitHub, temas e os
vocabulários (tags e status de todas as tabelas) se editam por tela. Nada
exige SQL no painel do Supabase depois da instalação.

**O schema é versionado e foi testado.** `0001_init.sql` foi aplicado num
schema descartável, o seed rodou em cima, e as funções de gate foram
verificadas — `check_master_token` aceita a senha do seed e recusa outra.

**Modo local em toda tela que fala com o backend.** Em `file://` ou
`localhost` o sistema roda contra mocks em memória, que reproduzem inclusive
os casos de erro. Dá para mexer na interface sem tocar no Supabase.

---

## 2. A ressalva que mais importa

**O caminho de instalação nunca foi percorrido do zero por outra pessoa.**

O `SETUP.md` foi escrito a partir do conhecimento de quem construiu o sistema,
não executando os passos num ambiente limpo. A migration foi testada
isoladamente; o fluxo completo — projeto Supabase novo → schema → deploy das
functions → apontar a config → primeiro login — não.

Na prática isso significa que você provavelmente vai encontrar um passo que
assume algo óbvio para quem já conhece o projeto. Se acontecer, é bug de
documentação e vale abrir uma issue: é exatamente o que o projeto precisa
descobrir.

---

## 3. Atritos de instalação

Dá para subir. Estas são as partes que ainda pedem trabalho manual.

### 3.1 Três arquivos a editar, não um

`assets/js/lifeos-config.js` é o arquivo de configuração, e cobre todas as
páginas do painel. Mas `assets/js/gate.js` e `login.html` — o fluxo de senha
das páginas protegidas do arquivo público — ainda têm o endereço do Supabase
e a chave em constantes próprias, com placeholders explícitos
(`https://SEU-PROJETO.supabase.co`).

Você vai trocar os três. Se não usar o blog, os dois últimos não importam.

### 3.2 Dados de exemplo cobrem só o essencial

O `seed.sql` cria a senha mestre, o token do MCP (placeholder inválido de
propósito), um projeto e cinco tarefas que funcionam como checklist.

O projeto inicial não é decoração: **toda tarefa exige um projeto**, então sem
ele a primeira ação do usuário falha.

Falta exemplo de nota, evento, manifestação e movimentação. Esses módulos
abrem vazios, o que é correto mas não ensina nada sobre o que eles fazem.

### 3.3 A identidade visual ainda é de alguém

O banner e o avatar em `assets/images/` são do autor. `LIFEOS_CONFIG.identidade`
troca nome, subtítulo e os dois caminhos de imagem num lugar só — mas alguém
precisa trocar.

A skill `/personalizar` (Claude Code) entrevista você e aplica isso, incluindo
a limpeza do que sobrou do repositório de origem.

---

## 4. Dívida de código

Nada aqui quebra hoje. São coisas que um colaborador deve saber antes de mexer.

### 4.1 `THEME_ACCENTS` em três cópias

`index.html`, `assets/js/publicar.js` e `assets/js/temas.js`. É o mapa que
define a cor da barra lateral de cada card no índice. Trocar uma cor exige
editar os três, e nada avisa se um ficar para trás.

Candidato claro a virar um arquivo de dados carregado por `<script>` — o mesmo
padrão de `manifest.js` e `lifeos-config.js`. Mexe no render do `index.html`,
que é a capa pública, então pede cuidado.

### 4.2 `lifeos.js` com 3.230 linhas

O hub concentra seis domínios num arquivo só. Ainda navegável, mas é onde um
erro custa mais caro. Não urge.

### 4.3 Helpers repetidos por cópia — e isso é de propósito

`IS_LOCAL_DEV` e `showDevBadge` aparecem em 9 arquivos; `esc` em 6.
**Isto é `LIFEOS.md` §2 funcionando como desenhado**, não um defeito: a
alternativa (um `lifeos-shared.js`) reintroduz o acoplamento que motivou a
separação das páginas.

O problema real é outro: **a regra não é verificada por nada.** Foi assim que
duas páginas nasceram sem `[hidden] { display: none !important; }` e travaram
em loading infinito — a linha existia nas outras e se perdeu ao copiar a
casca. Um teste que compare as cópias vale mais que centralizá-las.

### 4.4 A documentação cita páginas que não existem

Vários docs (`VISUAL.md`, `EXPANDING_PAGES.md`, `MANIFEST.md`) usam entradas
da instância de origem como exemplo — "ver `pages/retrato.html`". Os arquivos
não vieram, porque são conteúdo pessoal.

O `EXPANDING_PAGES.md` é o caso extremo: o documento inteiro descreve um
padrão em torno de uma página específica que não está aqui.

---

## 5. Escolhas de segurança que você deve conhecer

Não são bugs — são o desenho. Mas se você vai confiar dados sensíveis ao
sistema, decida conscientemente.

### 5.1 As senhas ficam em texto puro

`access_tokens.token` guarda o valor como digitado. Elas são comparadas por
igualdade dentro de funções `SECURITY DEFINER` e nunca saem do banco (a tela
de senhas só recebe versões mascaradas), mas quem tiver acesso ao banco lê
todas.

Um hash seria o correto. Exigiria trocar `token = p_token` por verificação de
hash em `check_master_token` e `check_page_access`.

### 5.2 O PAT do GitHub chega ao navegador

Para publicar uma página, `publicar.html` busca o token no Supabase e o usa
direto do browser. Quem souber a senha mestre e abrir essa tela consegue
escrever no seu repositório.

A tela ensina a reduzir o estrago — escopar o token em **um** repositório e só
a permissão Contents — mas não elimina. O fim da linha é a publicação virar
uma Edge Function que segura o PAT server-side.

### 5.3 Autenticação é uma senha, não um sistema de contas

Não é multiusuário, não tem OAuth, não tem recuperação de senha. Isso é
deliberado: é um sistema pessoal. Mas significa que "compartilhar acesso" é
compartilhar uma senha.

O único escalonamento é o escopo por página do arquivo público: senhas
não-mestre abrem só as entradas que você conceder a elas.

### 5.4 CORS é aberto por padrão

`LIFEOS_ALLOWED_ORIGIN` não definido significa `*`. É o que faz um fork
funcionar em qualquer domínio sem configuração.

Isso não afrouxa nada neste desenho: a autenticação é a senha enviada **no
corpo**, não um cookie. Não há credencial que o browser anexe sozinho, então
uma página maliciosa não consegue nada sem já saber a senha — e se souber, o
CORS não a impediria (`curl` ignora CORS). A fronteira real é
`check_master_token`, server-side.

Quem quiser restringir mesmo assim define o secret.

---

## 6. Por onde contribuir

Em ordem de retorno, se você quiser ajudar:

1. **Instalar seguindo o `SETUP.md` e relatar onde travou** (§2) — é o que o
   projeto mais precisa e não exige escrever código
2. Exemplos de nota, evento e movimentação no `seed.sql` (§3.2)
3. `gate.js` e `login.html` lendo de `lifeos-config.js` (§3.1)
4. `THEME_ACCENTS` num arquivo só (§4.1)
5. Hash nas senhas (§5.1)
6. Publicação via Edge Function, tirando o PAT do browser (§5.2)

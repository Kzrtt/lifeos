# PAGE_TEMPLATE.md — Template HTML Base

> Usa este template como ponto de partida para qualquer nova entrada em `pages/`.
> Substitui todos os valores entre [COLCHETES].
> Lê VISUAL.md antes para garantir aderência ao sistema visual.

**Isto é um ponto de partida, não um contrato.** As entradas recentes divergem
bastante deste esqueleto (`.nav` / `.hero` / `.layout` / `.toc` em vez de
`<header>` / `.narrative`) e isso é esperado — cada entrada tem personalidade
própria. O que **não** varia é o que está marcado como obrigatório abaixo: os
caminhos relativos, os scripts compartilhados e a versão pinada do Mermaid.

---

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <!-- OBRIGATÓRIO: primeiro script do head, sem defer/async (ver AUTH.md §3) -->
  <script src="../assets/js/share-guard.js"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <link rel="icon" href="../assets/images/icon.png">
  <title>LifeOS · [TÍTULO DA ENTRADA]</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=JetBrains+Mono:wght@400;500&family=EB+Garamond:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
  <!-- OBRIGATÓRIO: versão pinada, igual em todas as páginas -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* Os NOMES destas variáveis são livres — cada entrada escolhe os seus.
       Os VALORES devem ficar na família da paleta escura (ver VISUAL.md). */
    :root {
      --bg: #0D0D0F;
      --bg-card: #111318;
      --text: #E8E0D4;
      --text-secondary: #9A8E82;
      --text-muted: #5A5249;
      --accent: #C4A882;
      --accent-dim: #7A6A56;
      --border: #2A2520;
      --tag-bg: #1A1812;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'EB Garamond', Georgia, serif;
      min-height: 100vh;
      padding: 0;
    }

    /* Gradiente radial de fundo */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: radial-gradient(ellipse at 30% 20%, #111318 0%, #0A0A0D 70%);
      z-index: -1;
    }

    /* ── HEADER ── */
    header {
      padding: 3rem 2rem 2rem;
      max-width: 900px;
      margin: 0 auto;
      border-bottom: 1px solid var(--border);
    }

    .back-link {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      letter-spacing: 0.15em;
      color: var(--text-muted);
      text-decoration: none;
      text-transform: uppercase;
      display: inline-block;
      margin-bottom: 2rem;
      transition: color 0.2s;
    }
    .back-link:hover { color: var(--accent); }

    .categories {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      letter-spacing: 0.2em;
      color: var(--accent-dim);
      text-transform: uppercase;
      margin-bottom: 0.75rem;
    }

    h1 {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: clamp(2.2rem, 5vw, 4rem);
      font-weight: 900;
      line-height: 1.1;
      color: var(--text);
      margin-bottom: 1rem;
    }

    h1 em {
      font-style: italic;
      color: var(--accent);
    }

    .subtitle {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 1.1rem;
      color: var(--text-secondary);
      line-height: 1.6;
      max-width: 600px;
      margin-bottom: 1.5rem;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      background: var(--tag-bg);
      border: 1px solid var(--border);
      padding: 0.2rem 0.5rem;
      text-transform: uppercase;
    }

    /* ── DIAGRAMA ── */
    .diagram-section {
      max-width: 1100px;
      margin: 0 auto;
      padding: 3rem 2rem;
    }

    .section-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      letter-spacing: 0.2em;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 1.5rem;
    }

    .diagram-wrapper {
      overflow-x: auto;
      padding: 2rem 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }

    .diagram-wrapper .mermaid {
      min-width: 600px;
    }

    /* ── NARRATIVA ── */
    .narrative {
      max-width: 720px;
      margin: 0 auto;
      padding: 3rem 2rem 5rem;
    }

    .narrative h2 {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--text);
      margin: 2.5rem 0 1rem;
    }

    .narrative h2:first-child { margin-top: 0; }

    .narrative p {
      font-size: 1.05rem;
      line-height: 1.85;
      color: var(--text-secondary);
      margin-bottom: 1.2rem;
    }

    .narrative strong {
      color: var(--text);
      font-weight: 600;
    }

    .narrative em {
      color: var(--accent);
      font-style: italic;
    }

    /* ── FOOTER ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      letter-spacing: 0.1em;
      color: var(--text-muted);
    }

    footer em {
      font-style: italic;
      color: var(--accent-dim);
    }

    @media (prefers-reduced-motion: no-preference) {
      header, .diagram-section, .narrative {
        animation: fadeIn 0.5s ease both;
      }
      .diagram-section { animation-delay: 0.1s; }
      .narrative { animation-delay: 0.2s; }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    }
  </style>
</head>
<body>

<header>
  <!-- OBRIGATÓRIO: ../ — a página vive em pages/ -->
  <a href="../index.html" class="back-link">← LifeOS</a>
  <div class="categories">[CATEGORIA 1] · [CATEGORIA 2]</div>
  <h1>[TÍTULO] em <em>[PALAVRA-CHAVE]</em></h1>
  <p class="subtitle">[SUBTÍTULO — frase descritiva, 1–2 linhas]</p>
  <div class="tags">
    <span class="tag">[TAG 1]</span>
    <span class="tag">[TAG 2]</span>
    <span class="tag">[TAG 3]</span>
  </div>
</header>

<section class="diagram-section">
  <div class="section-label">mapa · [DATA DE CRIAÇÃO]</div>
  <div class="diagram-wrapper">
    <div class="mermaid">
[DIAGRAMA MERMAID AQUI]
    </div>
  </div>
</section>

<section class="narrative">
  <h2>[Título da primeira seção narrativa]</h2>
  <p>[Parágrafo de abertura]</p>

  <h2>[Título da segunda seção]</h2>
  <p>[Desenvolvimento]</p>
</section>

<footer>
  <em>[Frase de assinatura — data, contexto, tom característico do projeto]</em><br>
  LifeOS · por Claude · Anthropic
</footer>

<!-- OBRIGATÓRIO: botão de voltar ao topo -->
<script src="../assets/js/back-to-top.js"></script>

<script>
  mermaid.initialize({
    startOnLoad: true,
    theme: 'base',
    themeVariables: {
      darkMode: true,
      background: '#111318',
      primaryColor: '#1A1812',
      primaryTextColor: '#E8E0D4',
      primaryBorderColor: '#3A3228',
      lineColor: '#C4A882',
      secondaryColor: '#141210',
      tertiaryColor: '#0D0B09',
      mainBkg: '#1A1812',
      nodeBorder: '#3A3228',
      clusterBkg: '#141210',
      titleColor: '#E8E0D4',
      edgeLabelBackground: '#1A1812',
      fontFamily: 'EB Garamond, Georgia, serif',
      fontSize: '14px',
    },
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
      rankSpacing: 60,
      nodeSpacing: 40,
    }
  });
</script>

</body>
</html>
```

---

## Notas de uso

- O `<footer>` sempre termina com uma frase de assinatura estilizada em itálico — ver padrão nas páginas existentes para calibrar o tom
- O diagrama Mermaid deve ter **no mínimo** 8–10 nós para justificar o espaço visual que ocupa
- A narrativa não é um resumo do diagrama — ela aprofunda, contextualiza, contradiz onde necessário
- Depois de criar a página, registra a entrada no manifest — ver [`MANIFEST.md`](MANIFEST.md), incluindo o cache-busting

### Páginas protegidas

**Não existe "bloco de autenticação Supabase" para colar no corpo da página.**
Proteção é uma linha no `<head>`, e só:

```html
<script data-page="[SLUG]" src="../assets/js/gate.js"></script>
```

O `data-page` é obrigatório — é o escopo do token. Ver [`AUTH.md`](AUTH.md) para
o fluxo completo e para o mecanismo alternativo (`access-gate.js`, sem senha).

### Scripts opcionais

| Script | Para quê | Onde colocar |
|---|---|---|
| `diagram-only.js` | Toggle "só o diagrama", para mapas grandes | antes de `</body>` |
| `share-link.js` | Botão "copiar link" com `?ref=share` | antes de `</body>`, exige `#share-btn` no markup |

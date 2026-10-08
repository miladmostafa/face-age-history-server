import type { AppConfig } from '../config.js';

export function renderDemoPage(config: AppConfig): string {
  const boot = JSON.stringify({
    faceageId: config.faceageClientId,
  }).replace(/</g, '\\u003c');

  const widget = config.faceageClientId
    ? `<div id="FaceAge-module" class="widget-host"></div>`
    : `<div class="callout">
        <h2>Add a Face Age Client ID</h2>
        <p>The widget renders here after you set <code>FACEAGE_CLIENT_ID</code>. Create a free Client ID at <a href="https://panel.getfaceage.com/">panel.getfaceage.com</a>, put it in <code>.env.local</code>, and restart the server. The history API on this page still works without it.</p>
      </div>
      <div id="FaceAge-module" class="widget-host widget-host-idle" hidden></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Face Age scan history demo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,680&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/face-age@2.4.13/dist/faceage.css" />
  <style>
    :root {
      --ink: #1e1a17;
      --muted: #5e564e;
      --paper: #f4efe8;
      --card: #fffdf9;
      --line: #e4d9cc;
      --accent: #b4236a;
      --accent-dark: #8c1552;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: "Source Sans 3", "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    a { color: var(--accent-dark); }
    header, main, footer { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 28px 0 8px; display: flex; gap: 16px; align-items: center; }
    header img { width: 56px; height: auto; }
    h1, h2, h3 { font-family: Fraunces, Georgia, serif; font-weight: 560; letter-spacing: -0.02em; }
    h1 { font-size: 2rem; margin: 0 0 6px; }
    .lede { margin: 0; color: var(--muted); max-width: 62ch; }
    main { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); gap: 24px; padding: 20px 0 48px; }
    .panel, .stage { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }
    .widget-host { min-height: 680px; }
    .widget-host-idle { min-height: 0; }
    .callout { background: #fff6ee; border: 1px dashed var(--line); border-radius: 14px; padding: 14px 16px; margin-bottom: 12px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; }
    input[type="text"] {
      width: 100%;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 10px;
      padding: 10px 12px;
      font: inherit;
    }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    button {
      border: 0;
      border-radius: 999px;
      padding: 9px 14px;
      font: inherit;
      font-weight: 600;
      background: var(--accent);
      color: white;
    }
    button.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    button.danger { background: #7a3030; }
    button:disabled { opacity: 0.55; }
    #status { min-height: 1.4em; color: var(--muted); margin: 12px 0; }
    .scan { border-top: 1px solid var(--line); padding: 12px 0; }
    .scan h3 { margin: 0 0 4px; font-size: 1.05rem; }
    .meta { color: var(--muted); font-size: 0.92rem; }
    pre {
      background: #241c22;
      color: #f6efe8;
      border-radius: 12px;
      padding: 12px;
      overflow: auto;
      font-size: 0.82rem;
    }
    footer { padding-bottom: 36px; color: var(--muted); }
    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; }
      .widget-host { min-height: 560px; }
    }
  </style>
</head>
<body>
  <header>
    <img src="https://static.getfaceage.com/logo.png" width="56" alt="Face Age logo, AI skin analysis from getfaceage.com" />
    <div>
      <h1>Face Age scan history demo</h1>
      <p class="lede">This page embeds the <a href="https://www.npmjs.com/package/face-age">face-age</a> widget and the history helper. The server mints a short-lived token for the demo user. The page never receives the API key. A saved scan is restored with <code>setHistoryData</code> on the next visit.</p>
    </div>
  </header>
  <main>
    <section class="stage" aria-label="Face Age skin analysis widget">
      ${widget}
    </section>
    <aside class="panel" aria-label="Stored scan history">
      <h2>History for this user</h2>
      <label for="user-id">Local demo user</label>
      <input id="user-id" type="text" name="user-id" autocomplete="off" value="123" />
      <p class="meta">Local stand-in only. This page asks the server to mint a short-lived token for the id you type. A production store reads the user id from its login session and keeps the API key on the server.</p>
      <div class="row">
        <button id="apply-user" type="button">Load this user</button>
        <button id="load-samples" class="secondary" type="button" disabled>Load sample scans</button>
        <button id="export-user" class="secondary" type="button" disabled>Export</button>
        <button id="delete-user" class="danger" type="button" disabled>Delete all</button>
      </div>
      <p id="status" role="status"></p>
      <div id="scan-list"></div>
      <h2>Snippet</h2>
      <pre><code>const session = await fetch('/api/face-age/session', { credentials: 'include' })
  .then((response) => response.json());

const faceAge = new FaceAge({
  elementId: 'FaceAge-module',
  faceageId: 'YOUR_CLIENT_ID',
  history: true,
});

FaceAgeHistory.attach(faceAge, {
  baseUrl: 'https://history.example.com',
  accessToken: session.accessToken,
}).then(() => faceAge.render());</code></pre>
    </aside>
  </main>
  <footer>
    <p>Analysis runs in the browser SDK and the Face Age cloud. This server stores the result payload only. <a href="https://getfaceage.com/">getfaceage.com</a> · <a href="/docs">OpenAPI docs</a></p>
  </footer>
  <script>window.DEMO_CONFIG = ${boot};</script>
  <script src="https://cdn.jsdelivr.net/npm/face-age@2.4.13/dist/faceage.js"></script>
  <script src="/face-age-history.js"></script>
  <script src="/demo.js"></script>
</body>
</html>`;
}

export function renderHomePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Face Age scan history server</title>
  <meta name="description" content="Self-hosted API that stores face-age skin analysis results per user and restores them for history and comparison." />
</head>
<body>
  <h1>Face Age scan history server</h1>
  <p>Self-hosted history API for the <a href="https://www.npmjs.com/package/face-age">face-age</a> skin analysis SDK from <a href="https://getfaceage.com/">getfaceage.com</a>.</p>
  <ul>
    <li><a href="/docs">OpenAPI documentation</a></li>
    <li><a href="/health">Health check</a></li>
    <li><a href="/openapi.json">OpenAPI JSON</a></li>
  </ul>
  <p>Set <code>DEMO_ENABLED=true</code> and a <code>FACEAGE_CLIENT_ID</code> from <a href="https://panel.getfaceage.com/">panel.getfaceage.com</a> to open the widget demo.</p>
</body>
</html>`;
}

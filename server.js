'use strict';

const os = require('os');
const { execSync } = require('child_process');
const express = require('express');

const pkg = require('./package.json');

const APP_NAME = pkg.name;
const VERSION = pkg.version;
const HOSTNAME = os.hostname();

// Resolved once at boot: the commit can't change while this process runs.
// Falls back to the env vars build platforms inject when .git isn't shipped.
const COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    const fromEnv = process.env.GIT_COMMIT || process.env.SOURCE_COMMIT;
    return fromEnv ? fromEnv.slice(0, 7) : 'unknown';
  }
})();

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]
  );

const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(APP_NAME)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem 1rem;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f6f7f9;
    color: #16181d;
  }
  main {
    width: 100%;
    max-width: 30rem;
    background: #fff;
    border: 1px solid #e4e6eb;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
  }
  h1 { margin: 0 0 1.5rem; font-size: 1.5rem; letter-spacing: -0.01em; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.75rem 1.5rem; }
  dt { color: #6b7280; font-size: 0.875rem; }
  dd {
    margin: 0;
    text-align: right;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  footer { margin-top: 1.75rem; font-size: 0.8125rem; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1115; color: #e8eaed; }
    main { background: #171a20; border-color: #2a2e37; box-shadow: none; }
    dt { color: #9aa1ad; }
    a { color: #7aa2f7; }
  }
</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(APP_NAME)}</h1>
    <dl>
      <dt>Version</dt><dd>${escapeHtml(VERSION)}</dd>
      <dt>Commit</dt><dd>${escapeHtml(COMMIT)}</dd>
      <dt>Host</dt><dd>${escapeHtml(HOSTNAME)}</dd>
    </dl>
    <footer><a href="/health">/health</a></footer>
  </main>
</body>
</html>
`;

const app = express();

app.get('/', (req, res) => {
  res.type('html').send(page());
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    version: VERSION,
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`${APP_NAME} ${VERSION} (${COMMIT}) listening on port ${port}`);
});

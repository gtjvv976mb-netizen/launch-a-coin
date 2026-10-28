export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #06080d; color: #eef3fa; color-scheme: dark; display: grid; place-items: center; min-height: 100vh; min-height: 100dvh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; min-width: 0; text-align: center; padding: clamp(1rem, 4vw, 2rem); overflow-wrap: anywhere; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #9ba8bc; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 44px; padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      a:focus-visible, button:focus-visible { outline: 2px solid #3dffb5; outline-offset: 4px; }
      .primary { background: #3dffb5; color: #021a10; box-shadow: 0 0 16px rgb(61 255 181 / 0.45); }
      .secondary { background: #151c29; color: #eef3fa; border-color: #3a465b; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}

/**
 * The server's own 500 page, sent when the app itself could not render (start.ts, server.ts). It stands alone, so
 * its few colours are copied from carddex-theme.css (true-black-flat: the warm near-black ground, ink and slate
 * text, the cream primary pill, a nested secondary pill and the cream focus ring) and the words match the in-app
 * error state (lib/mintdex/copy.ts ROUTE_ERROR).
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page did not load | Launch a Card</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#0d0c0b" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html { color-scheme: dark; -webkit-font-smoothing: antialiased; }
      body { display: grid; place-items: center; min-height: 100dvh; margin: 0; padding: 24px 16px; background: #0d0c0b; color: #f6f1e7; font: 14px/20px "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { width: 100%; max-width: 360px; text-align: center; overflow-wrap: anywhere; }
      h1 { margin: 0 0 4px; font-size: 16px; line-height: 24px; font-weight: 600; text-wrap: balance; }
      p { margin: 0 0 16px; color: #b8b0a3; text-wrap: pretty; }
      .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 16px 20px; }
      button, a { position: relative; font: inherit; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      button { height: 36px; padding: 0 16px; border: 0; border-radius: 999px; background: #f6f1e7; color: #0d0c0b; transition: background-color 120ms ease, transform 140ms cubic-bezier(.22,1,.36,1); }
      button::after { content: ""; position: absolute; inset: -4px; border-radius: inherit; }
      a { color: #f6f1e7; font-weight: 500; text-decoration: underline 1px #756d62; text-underline-offset: 3px; transition: text-decoration-color 120ms ease; }
      a::before { content: ""; position: absolute; inset: -12px -8px; }
      button:active { transform: scale(.96); }
      :focus-visible { outline: 2px solid #f6f1e7; outline-offset: 2px; }
      @media (hover: hover) and (pointer: fine) {
        button:hover { background: #ffffff; }
        a:hover { text-decoration-color: #f6f1e7; }
      }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } button:active { transform: none; } }
    </style>
  </head>
  <body>
    <main>
      <h1>This page did not load</h1>
      <p>Something went wrong on our side. Try again, or head back home.</p>
      <div class="actions">
        <button type="button" onclick="location.reload()">Try again</button>
        <a href="/">Go home</a>
      </div>
    </main>
  </body>
</html>`;
}

import { defineConfig, type Plugin } from 'vite';

// The chat app that runs inside the iframe. loader.js is built separately (vite.loader.config.ts).
// The dev server injects CSS as inline <style> tags, which the page's strict CSP (style-src 'self')
// blocks. Relax style-src for `vite dev` only; builds keep the strict policy (CSS is a linked file).
const devInlineStyles: Plugin = {
  name: 'dev-inline-styles',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
};

export default defineConfig({
  plugins: [devInlineStyles],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist', emptyOutDir: true },
});

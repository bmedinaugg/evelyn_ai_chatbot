import { defineConfig, type Plugin } from 'vite';

const API = process.env.PORTAL_API_URL ?? 'http://localhost:8787';

// The dev server injects CSS as inline <style> tags, which the page's strict CSP (style-src 'self')
// blocks. Relax style-src for `vite dev` only; builds keep the strict policy (CSS is a linked file).
const devInlineStyles: Plugin = {
  name: 'dev-inline-styles',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
};

// Served under /portal/ on the same origin as its API (CloudFront in AWS, this proxy locally).
export default defineConfig({
  base: '/portal/',
  plugins: [devInlineStyles],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/portal/api': { target: API },
      '/portal/auth': { target: API },
    },
  },
});

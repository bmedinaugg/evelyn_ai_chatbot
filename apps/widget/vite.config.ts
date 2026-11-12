import { defineConfig } from 'vite';

// The chat app that runs inside the iframe. loader.js is built separately (vite.loader.config.ts).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist', emptyOutDir: true },
});

import { defineConfig } from 'vite';

// loader.js: a classic script for the help portal's layout (single file, no imports, no hash).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: 'src/loader.ts',
      formats: ['iife'],
      name: 'TrainmoreChatLoader',
      fileName: () => 'loader.js',
    },
  },
});

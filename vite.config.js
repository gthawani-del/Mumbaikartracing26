import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// Only the root game is multi-page; the cinematic build has its own entry.
export default defineConfig({ build: { rollupOptions: { input: {
  lobby: resolve(import.meta.dirname, 'index.html'),
  marineDrive: resolve(import.meta.dirname, 'marine-drive.html'),
} } } });

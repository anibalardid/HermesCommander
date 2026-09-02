import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Exclude Playwright E2E specs — they run via `playwright test`, not vitest.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});

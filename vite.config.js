import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/chrome',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(process.cwd(), 'sidepanel.html')
      }
    }
  }
});

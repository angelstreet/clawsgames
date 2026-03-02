import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const basePath = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: basePath,
  server: {
    port: 3010,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5010',
        changeOrigin: true,
      },
    },
  },
});

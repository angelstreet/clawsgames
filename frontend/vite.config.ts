import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const basePath = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: basePath,
  server: {
    port: 3014,
    allowedHosts: ['clawsgames.angelstreet.io', 'localhost', '65.108.14.251'],
    proxy: {
      '/api': {
        target: 'http://localhost:5010',
        changeOrigin: true,
      },
      '/clawsgames/api': {
        target: 'http://localhost:5010',
        rewrite: (path: string) => path.replace('/clawsgames/api', '/api'),
        changeOrigin: true,
      },
    },
  },
});

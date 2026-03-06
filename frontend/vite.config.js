import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const basePath = process.env.VITE_BASE_PATH || '/clawsgames/'

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    allowedHosts: true,
    port: 3014,
    proxy: {
      '/clawsgames/api': {
        target: 'http://localhost:5010',
        rewrite: (path) => path.replace('/clawsgames/api', '/api'),
      }
    },
    fs: {
      allow: ['..'],
    },
    hmr: {
      overlay: false,
    },
  },
  optimizeDeps: {
    include: [],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})

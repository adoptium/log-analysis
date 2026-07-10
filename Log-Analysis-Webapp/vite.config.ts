import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/analyze': 'http://localhost:8000',
      '/top-templates': 'http://localhost:8000',
      '/in-window': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/saved-analyses': 'http://localhost:8000',
    },
  },
})

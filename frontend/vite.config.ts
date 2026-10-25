import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
    // Phones reach the dev server through a Cloudflare tunnel (make tunnel).
    allowedHosts: ['.trycloudflare.com', '.lorebook.tech'],
  },
})

import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    // ws: answers stream over a WebSocket under /api (see lib/answerStream.ts).
    proxy: { '/api': { target: 'http://localhost:8000', ws: true } },
    // Phones reach the dev server through a Cloudflare tunnel (make tunnel).
    allowedHosts: ['.trycloudflare.com', '.lorebook.tech'],
  },
})

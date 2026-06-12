import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // Inline PNG del visualizador en el bundle JS (Render sirve SPA; evita 404 en /assets/*.png)
    assetsInlineLimit: 512000,
  },
})

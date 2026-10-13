import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev, the Express API runs on :4000; in production set VITE_API_URL instead.
    proxy: { '/api': 'http://localhost:4000' },
  },
})

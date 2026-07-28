import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    https: {
      cert: fs.readFileSync('./localhost+1.pem'),
      key:  fs.readFileSync('./localhost+1-key.pem')
    }
  }
})
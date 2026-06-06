import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const REPO_NAME = 'custom-geography-builder'

export default defineConfig({
  plugins: [react()],
  base: `/${REPO_NAME}/`,
  worker: {
    format: 'es',
  },
})

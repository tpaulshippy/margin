import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { scoringApiPlugin } from './server/api.js'

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), scoringApiPlugin()],
    preview: {
      allowedHosts: ['margin.syftlearning.app'],
    },
  }
})

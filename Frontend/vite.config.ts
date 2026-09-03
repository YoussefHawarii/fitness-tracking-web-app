import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Settings > About shows this as the app's build-time version — no
  // backend call needed since it's a Frontend-only fact (research.md §8).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})

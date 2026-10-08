import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { ocrAssetsPlugin } from './ocrAssets.ts'

// `vite preview` serves the production build with the same
// Content-Security-Policy Vercel sends, so the policy can be checked
// locally before a deploy.
const vercel = JSON.parse(
  readFileSync(fileURLToPath(new URL('./vercel.json', import.meta.url)), 'utf-8'),
) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> }
const contentSecurityPolicy = vercel.headers
  .flatMap((rule) => rule.headers)
  .find((header) => header.key === 'Content-Security-Policy')?.value

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ocrAssetsPlugin()],
  preview: {
    headers: contentSecurityPolicy
      ? { 'Content-Security-Policy': contentSecurityPolicy }
      : {},
  },
  // Settings > About shows this as the app's build-time version — no
  // backend call needed since it's a Frontend-only fact (research.md §8).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})

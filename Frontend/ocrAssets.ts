import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// Self-hosts every Tesseract.js runtime asset on the app's own origin
// (ADR 0008): nothing is ever fetched from jsdelivr/unpkg/projectnaptha,
// because even an asset request would tell a third party when a user scans.
//
// On each dev/build start the assets are copied out of node_modules into
// public/ocr/ (gitignored) under versioned directory names, so a dependency
// upgrade changes every URL and the long-lived cache headers in vercel.json
// can never serve a stale engine against a new worker.

// Recognition languages shipped to the browser. Tesseract.js's default
// LSTM-only data is the quality-oriented "4.0.0_best_int" set.
export const OCR_LANGUAGES = ['eng', 'ara'] as const
const LANGUAGE_DATA_SET = '4.0.0_best_int'

export interface OcrAssetPaths {
  workerPath: string
  corePath: string
  langPath: string
  // IndexedDB key prefix for Tesseract.js's language-data cache; versioned
  // so an upgraded model is never shadowed by a cached older one.
  cachePath: string
}

function packageVersion(root: string, name: string): string {
  const pkg = JSON.parse(
    readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf-8'),
  ) as { version: string }
  return pkg.version
}

function copyIfChanged(from: string, to: string): void {
  if (existsSync(to) && statSync(to).size === statSync(from).size) return
  copyFileSync(from, to)
}

interface CopyPlan {
  paths: OcrAssetPaths
  dirs: Map<string, Array<{ from: string; name: string }>>
}

export function planOcrAssets(root: string): CopyPlan {
  const modules = join(root, 'node_modules')
  const tesseractVersion = packageVersion(root, 'tesseract.js')
  const coreVersion = packageVersion(root, 'tesseract.js-core')

  const workerDir = `tesseract.js@${tesseractVersion}`
  const coreDir = `tesseract.js-core@${coreVersion}`

  // Every engine build variant is hosted so Tesseract.js can pick the one
  // the device supports (plain, SIMD, relaxed SIMD; LSTM-only or not).
  const coreRoot = join(modules, 'tesseract.js-core')
  const coreFiles = readdirSync(coreRoot)
    .filter((f) => f.endsWith('.wasm.js'))
    .map((name) => ({ from: join(coreRoot, name), name }))

  const langFiles = OCR_LANGUAGES.map((lang) => ({
    from: join(
      modules,
      '@tesseract.js-data',
      lang,
      LANGUAGE_DATA_SET,
      `${lang}.traineddata.gz`,
    ),
    name: `${lang}.traineddata.gz`,
  }))
  const langHash = createHash('sha256')
  for (const file of langFiles) langHash.update(readFileSync(file.from))
  const langDir = `tessdata-${LANGUAGE_DATA_SET}-${langHash
    .digest('hex')
    .slice(0, 12)}`

  return {
    paths: {
      workerPath: `/ocr/${workerDir}/worker.min.js`,
      corePath: `/ocr/${coreDir}`,
      langPath: `/ocr/${langDir}`,
      cachePath: `ocr-${langDir}`,
    },
    dirs: new Map([
      [
        workerDir,
        [
          {
            from: join(modules, 'tesseract.js', 'dist', 'worker.min.js'),
            name: 'worker.min.js',
          },
        ],
      ],
      [coreDir, coreFiles],
      [langDir, langFiles],
    ]),
  }
}

export function ocrAssetsPlugin(): Plugin {
  return {
    name: 'self-hosted-ocr-assets',
    config(config) {
      const root = config.root ?? process.cwd()
      const plan = planOcrAssets(root)
      const outRoot = join(root, 'public', 'ocr')
      mkdirSync(outRoot, { recursive: true })
      for (const existing of readdirSync(outRoot)) {
        if (!plan.dirs.has(existing)) {
          rmSync(join(outRoot, existing), { recursive: true, force: true })
        }
      }
      for (const [dir, files] of plan.dirs) {
        mkdirSync(join(outRoot, dir), { recursive: true })
        for (const file of files) {
          copyIfChanged(file.from, join(outRoot, dir, file.name))
        }
      }
      return {
        define: {
          __OCR_ASSETS__: JSON.stringify(plan.paths),
          __OCR_LANGUAGES__: JSON.stringify(OCR_LANGUAGES),
        },
      }
    },
  }
}

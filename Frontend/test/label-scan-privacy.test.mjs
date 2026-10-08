import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// The privacy promise behind label scanning (ADR 0008), checked where code
// can check it: the enforced Content-Security-Policy, where the OCR
// runtime is loaded from, the wording users see, and that the scanning
// code logs nothing. The network inspection on real devices is a manual
// release check.

let vite;
let assets;
let session;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [assets, session] = await Promise.all([
    vite.ssrLoadModule('/ocrAssets.ts'),
    vite.ssrLoadModule('/src/features/label-scan/labelScanSession.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

function contentSecurityPolicy() {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf-8'));
  const rule = vercel.headers.find((r) => r.source === '/(.*)');
  const header = rule.headers.find((h) => h.key === 'Content-Security-Policy');
  return Object.fromEntries(
    header.value
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .map(([name, ...values]) => [name, values]),
  );
}

const OCR_CDNS = /jsdelivr|unpkg|projectnaptha|tessdata\.|githubusercontent/;

test('the site-wide CSP is enforced and keeps OCR on this origin', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf-8'));
  const keys = vercel.headers.flatMap((r) => r.headers.map((h) => h.key));
  assert.ok(keys.includes('Content-Security-Policy'));
  assert.equal(keys.includes('Content-Security-Policy-Report-Only'), false);

  const csp = contentSecurityPolicy();
  assert.deepEqual(csp['default-src'], ["'self'"]);
  // The worker is a same-origin script, never a blob: URL.
  assert.deepEqual(csp['worker-src'], ["'self'"]);
  // The engine compiles WebAssembly; plain eval stays forbidden.
  assert.ok(csp['script-src'].includes("'wasm-unsafe-eval'"));
  assert.equal(csp['script-src'].includes("'unsafe-eval'"), false);
  assert.equal(csp['script-src'].includes("'unsafe-inline'"), false);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);

  for (const [directive, values] of Object.entries(csp)) {
    for (const value of values) {
      assert.doesNotMatch(value, OCR_CDNS, `${directive} ${value}`);
      assert.equal(value.includes('*'), false, `${directive} ${value}`);
    }
  }
  // Requests may go only to this site, the API, Cloudinary (avatar
  // upload) and Google sign-in.
  assert.deepEqual(csp['connect-src'], [
    "'self'",
    'https://fitness-tracking-api.vercel.app',
    'https://api.cloudinary.com',
    'https://accounts.google.com/gsi/',
  ]);
});

test('every OCR runtime asset path is on this origin', () => {
  const { paths } = assets.planOcrAssets(process.cwd());
  for (const [name, path] of Object.entries(paths)) {
    if (name === 'cachePath') continue;
    assert.match(path, /^\/ocr\//, name);
  }
  assert.equal(assets.OCR_LANGUAGES.includes('ara'), true);
  assert.equal(assets.OCR_LANGUAGES.includes('eng'), true);
});

test('the privacy note promises only what is true', () => {
  const note = session.LABEL_SCAN_PRIVACY_NOTE;
  assert.equal(
    note,
    'Your label photo and the text read from it are processed on this device and are never uploaded or saved. Only the values you review and submit are sent to your account. The first scan downloads the text-recognition engine from this site; your browser may keep that engine cached.',
  );
  assert.doesNotMatch(note, /nothing is stored|offline|accura|guarantee/i);
});

test('the scanning code never logs and its errors carry no recognised text', () => {
  const dir = 'src/features/label-scan';
  for (const file of readdirSync(dir)) {
    const source = readFileSync(join(dir, file), 'utf-8');
    assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/, file);
  }
  // Every error the session can show is a fixed message.
  for (const message of [
    session.ENGINE_LOAD_FAILED_MESSAGE,
    session.IMAGE_FORMAT_MESSAGE,
    session.IMAGE_FAILED_MESSAGE,
  ]) {
    assert.equal(typeof message, 'string');
  }
  const sessionSource = readFileSync(join(dir, 'labelScanSession.ts'), 'utf-8');
  assert.doesNotMatch(sessionSource, /err\.message|String\(err\)|\$\{err/);
});

/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Same-origin Tesseract.js asset locations, injected by ocrAssets.ts.
declare const __OCR_ASSETS__: {
  workerPath: string;
  corePath: string;
  langPath: string;
  cachePath: string;
};
declare const __OCR_LANGUAGES__: readonly string[];

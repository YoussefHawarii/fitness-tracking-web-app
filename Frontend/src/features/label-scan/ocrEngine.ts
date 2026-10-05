import { layoutFromBlocks, type OcrLayout } from './ocrLayout';

// The on-device OCR engine (ADR 0008). Tesseract.js is imported only when
// label scanning is opened — never part of the main bundle — and every
// runtime asset (worker, engine builds, language data) is loaded from this
// app's own origin. The photo goes only to the in-browser worker; nothing
// here sends it, or the recognised text, anywhere else.

export type OcrProgressStage = 'loading' | 'recognizing';

export interface OcrProgress {
  stage: OcrProgressStage;
  // 0-1 within the stage.
  progress: number;
}

export interface OcrEngine {
  recognize(image: Blob): Promise<OcrLayout>;
  terminate(): Promise<void>;
}

const OEM_LSTM_ONLY = 1;

export async function createTesseractEngine(
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrEngine> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker([...__OCR_LANGUAGES__], OEM_LSTM_ONLY, {
    workerPath: __OCR_ASSETS__.workerPath,
    corePath: __OCR_ASSETS__.corePath,
    langPath: __OCR_ASSETS__.langPath,
    cachePath: __OCR_ASSETS__.cachePath,
    // A same-origin worker script rather than a blob: URL, so the
    // Content-Security-Policy can stay at worker-src 'self'.
    workerBlobURL: false,
    // Progress only — logger messages carry status and a fraction, never
    // recognised text. Nothing is written to the console.
    logger: (message) => {
      onProgress({
        stage:
          message.status === 'recognizing text' ? 'recognizing' : 'loading',
        progress: message.progress,
      });
    },
    errorHandler: () => undefined,
  });

  return {
    async recognize(image) {
      const { data } = await worker.recognize(
        image,
        {},
        { blocks: true, text: false },
      );
      return layoutFromBlocks(data.blocks);
    },
    async terminate() {
      await worker.terminate();
    },
  };
}

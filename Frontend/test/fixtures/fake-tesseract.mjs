// A recording stand-in for tesseract.js, aliased in place of the real
// package by label-scan-engine.test.mjs. It records how the app's engine
// configures and drives the worker; it never loads or downloads anything.

export const calls = [];

const word = (text, x0, y0 = 10) => ({
  text,
  confidence: 95,
  bbox: { x0, y0, x1: x0 + 40, y1: y0 + 20 },
});
const defaultWords = () => [word('Protein', 10), word('21', 100)];
let words = defaultWords();

// The words every recognition returns, in full-photo pixel coordinates —
// as real Tesseract reports them even when it reads only a rectangle.
// Called with no argument, restores the default words.
export function setWords(next) {
  words = next ?? defaultWords();
}

// What a number's re-read (single-line mode) sees, as one word covering the
// whole crop. Without it a re-read returns the same words as every other
// recognition. Called with no argument, restores that.
let rereadText;
export function setRereadText(next) {
  rereadText = next;
}

export async function createWorker(langs, oem, options) {
  calls.push({ type: 'createWorker', langs, oem, options });
  options.logger?.({ status: 'loading tesseract core', progress: 0.5 });
  // The language and page-segmentation mode the worker is set to, recorded
  // with every recognition.
  let language;
  let pageSegMode;
  return {
    async reinitialize(next) {
      language = next;
      // Real tesseract.js re-creates the API on reinitialize, so every
      // parameter (the page mode included) is back at its default.
      pageSegMode = undefined;
      calls.push({ type: 'reinitialize', language: next });
    },
    async setParameters(parameters) {
      if (parameters.tessedit_pageseg_mode !== undefined) {
        pageSegMode = String(parameters.tessedit_pageseg_mode);
      }
      calls.push({ type: 'setParameters', parameters });
    },
    async recognize(image, options) {
      calls.push({ type: 'recognize', image, options, language, pageSegMode });
      options?.logger?.({ status: 'recognizing text', progress: 1 });
      const seen =
        pageSegMode === '7' && rereadText !== undefined
          ? [
              {
                text: rereadText,
                confidence: 95,
                bbox: { x0: 0, y0: 0, x1: 100000, y1: 100000 },
              },
            ]
          : words.map((w) => structuredClone(w));
      return {
        data: {
          blocks: [{ paragraphs: [{ lines: [{ words: seen }] }] }],
        },
      };
    },
    async terminate() {
      calls.push({ type: 'terminate' });
    },
  };
}

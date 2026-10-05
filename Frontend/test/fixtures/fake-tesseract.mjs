// A recording stand-in for tesseract.js, aliased in place of the real
// package by label-scan-engine.test.mjs. It records how the app's engine
// configures and drives the worker; it never loads or downloads anything.

export const calls = [];

export async function createWorker(langs, oem, options) {
  calls.push({ type: 'createWorker', langs, oem, options });
  options.logger?.({ status: 'loading tesseract core', progress: 0.5 });
  return {
    async reinitialize(language) {
      calls.push({ type: 'reinitialize', language });
    },
    async setParameters(parameters) {
      calls.push({ type: 'setParameters', parameters });
    },
    async recognize(image, options) {
      calls.push({ type: 'recognize', image, options });
      options?.logger?.({ status: 'recognizing text', progress: 1 });
      const word = (text, x0) => ({
        text,
        confidence: 95,
        bbox: { x0, y0: 10, x1: x0 + 40, y1: 30 },
      });
      return {
        data: {
          blocks: [
            {
              paragraphs: [
                { lines: [{ words: [word('Protein', 10), word('21', 100)] }] },
              ],
            },
          ],
        },
      };
    },
    async terminate() {
      calls.push({ type: 'terminate' });
    },
  };
}

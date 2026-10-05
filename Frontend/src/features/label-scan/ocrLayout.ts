// The word-level layout a Label scan works from: each recognised word with
// its position on the photo and Tesseract's confidence. This is the only
// OCR shape the Label reader understands, so it can be unit-tested from
// fixtures without running Tesseract.

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: BBox;
  // 0-100, as reported by Tesseract.
  confidence: number;
}

export interface OcrLayout {
  words: OcrWord[];
}

// Minimal structural view of Tesseract.js's `blocks` output (since v6 it
// must be requested with `{ blocks: true }`); only what we read is typed.
interface TesseractBlock {
  paragraphs?: Array<{
    lines?: Array<{
      words?: Array<{ text: string; bbox: BBox; confidence: number }>;
    }>;
  }>;
}

// Flattens blocks → paragraphs → lines → words. Tesseract's own block and
// line grouping is deliberately discarded: on a nutrition table it often
// splits one visual row across blocks, so the reader regroups words by
// position instead.
export function layoutFromBlocks(
  blocks: readonly TesseractBlock[] | null | undefined,
): OcrLayout {
  const words: OcrWord[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text.trim();
          if (!text) continue;
          words.push({
            text,
            bbox: { ...word.bbox },
            confidence: word.confidence,
          });
        }
      }
    }
  }
  return { words };
}

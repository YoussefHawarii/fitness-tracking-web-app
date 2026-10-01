const RETAIL_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;
type RetailFormat = (typeof RETAIL_FORMATS)[number];

export type NativeBarcodeDetector = {
  detect(source: unknown): Promise<Array<{ format: string; rawValue: string }>>;
};

export type NativeBarcodeDetectorConstructor = {
  new (options: { formats: RetailFormat[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
};

function validCheckDigit(value: string): boolean {
  const digits = [...value].map(Number);
  const body = digits.slice(0, -1);
  const sum = body.reduce(
    (total, digit, index) =>
      total + digit * ((body.length - index) % 2 === 1 ? 3 : 1),
    0,
  );
  return (10 - (sum % 10)) % 10 === digits[digits.length - 1];
}

function expandUpce(value: string): string {
  const [system, a, b, c, d, e, f, check] = value;
  if ('012'.includes(f)) return `${system}${a}${b}${f}0000${c}${d}${e}${check}`;
  if (f === '3') return `${system}${a}${b}${c}00000${d}${e}${check}`;
  if (f === '4') return `${system}${a}${b}${c}${d}00000${e}${check}`;
  return `${system}${a}${b}${c}${d}${e}0000${f}${check}`;
}

export function acceptRetailBarcode(
  format: string,
  rawValue: string,
): string | null {
  const length = { ean_13: 13, ean_8: 8, upc_a: 12, upc_e: 8 }[
    format as RetailFormat
  ];
  if (!length || rawValue.length !== length || !/^\d+$/.test(rawValue))
    return null;
  if (format === 'upc_e') {
    if (rawValue[0] !== '0' && rawValue[0] !== '1') return null;
    return validCheckDigit(expandUpce(rawValue)) ? rawValue : null;
  }
  return validCheckDigit(rawValue) ? rawValue : null;
}

export async function createNativeDetector(
  Ctor: NativeBarcodeDetectorConstructor | undefined,
) {
  if (!Ctor) return null;
  try {
    const supported = await Ctor.getSupportedFormats();
    if (!supported.includes('ean_13')) return null;
    const formats = RETAIL_FORMATS.filter((format) =>
      supported.includes(format),
    );
    const detector = new Ctor({ formats });
    return {
      async detect(source: unknown): Promise<string | null> {
        const results = await detector.detect(source);
        for (const { format, rawValue } of results) {
          const accepted = acceptRetailBarcode(format, rawValue);
          if (accepted !== null) return accepted;
        }
        return null;
      },
    };
  } catch {
    return null;
  }
}

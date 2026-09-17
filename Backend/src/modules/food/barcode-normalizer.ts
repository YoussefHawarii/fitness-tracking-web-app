// Central barcode normalization — the single place that decides what counts
// as a valid retail barcode and what canonical string represents it
// internally (DB key, provider lookup key). Every barcode-accepting endpoint
// routes through this instead of validating/transforming independently.
//
// Deliberately conservative: a transformation is only applied when it's a
// well-established, lossless equivalence (UPC-A <-> EAN-13 via the standard
// leading-zero rule — the exact "leading-zero difference" retail barcodes are
// known for). UPC-E is accepted as a valid format in its own right but is NOT
// expanded to UPC-A/EAN-13 here: that expansion follows a specific per-digit
// compression table, and applying a hand-rolled, unverified version of it
// would risk silently mapping a scan to the wrong 12-digit code — a much
// worse failure than just not collapsing UPC-E into EAN-13 today. A verified
// UPC-E->UPC-A expansion is reasonable future work if it ever proves
// necessary (UPC-E is rare on Egyptian retail packaging in the first place).
export type BarcodeFormat = 'EAN_13' | 'EAN_8' | 'UPC_A' | 'UPC_E';

export interface NormalizedBarcode {
  // Exactly what was scanned/typed, after trimming.
  raw: string;
  // The value used as the DB key and the provider lookup key everywhere in
  // this app. For UPC-A, this is the equivalent 13-digit EAN-13 (a "0"
  // prepended) — the same numeric product identity, just GS1's other
  // standard spelling of it. For every other format, canonical === raw.
  canonical: string;
  // Informational only — an 8-digit numeric string is always classified as
  // EAN_8 here (far more common than an 8-digit UPC-E-with-check-digit in
  // practice), but since no transformation is applied to 8-digit codes
  // either way, a mislabeled format never affects the canonical value used
  // for lookups/dedup.
  format: BarcodeFormat;
}

// GS1's check-digit algorithm is the same shape for EAN-13, EAN-8, and UPC-A:
// starting from the digit immediately to the left of the check digit and
// moving left, weights alternate 3, 1, 3, 1, ...; the check digit is
// (10 - (weightedSum % 10)) % 10. Verified against the published EAN-13
// example 5901234123457 and the UPC-A example 036000291452.
function hasValidCheckDigit(digits: string): boolean {
  const checkDigit = Number(digits[digits.length - 1]);
  let sum = 0;
  // Iterating left to right over every digit but the last: the digit right
  // before the check digit (second-to-last overall) gets weight 3, and it
  // alternates from there — equivalent to weight 3 on every other position
  // counting back from the end.
  for (let i = 0; i < digits.length - 1; i++) {
    const distanceFromCheckDigit = digits.length - 1 - i;
    const weight = distanceFromCheckDigit % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function normalizeBarcode(input: string): NormalizedBarcode | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  // Reject rather than guess: any leftover non-digit character (stray
  // scanner formatting, a pasted SKU, etc.) means this isn't a clean numeric
  // retail barcode, so silently stripping characters could turn one real
  // barcode into a different one.
  if (!/^[0-9]+$/.test(trimmed)) return null;

  switch (trimmed.length) {
    case 13:
      return hasValidCheckDigit(trimmed)
        ? { raw: trimmed, canonical: trimmed, format: 'EAN_13' }
        : null;
    case 12:
      return hasValidCheckDigit(trimmed)
        ? { raw: trimmed, canonical: `0${trimmed}`, format: 'UPC_A' }
        : null;
    case 8:
      return hasValidCheckDigit(trimmed)
        ? { raw: trimmed, canonical: trimmed, format: 'EAN_8' }
        : null;
    case 6:
    case 7:
      // UPC-E's own check-digit placement depends on the specific
      // compression variant (see the module comment above on why this app
      // doesn't attempt UPC-E expansion) — not validated here.
      return { raw: trimmed, canonical: trimmed, format: 'UPC_E' };
    default:
      return null;
  }
}

// Unit spellings a nutrition label prints, in English and Arabic, shared by
// the Label reader (which turns them into units) and the recognition passes
// (which must not let an Arabic unit word displace the "100" of a per-100
// heading). One list, so a spelling added for one is known to the other.

const ARABIC_GRAM_UNITS = ['جم', 'جرام', 'جرامات', 'غ', 'غم', 'غرام', 'غرامات'];
const ARABIC_MILLIGRAM_UNITS = [
  'مجم',
  'ملجم',
  'ملغ',
  'مغ',
  'ملغم',
  'مليجرام',
  'ملليجرام',
];

export type QuantityUnit = 'kg' | 'ml' | 'l' | 'cl';

export const MASS_UNITS: ReadonlySet<string> = new Set([
  'g',
  'gm',
  'gr',
  'grams',
  'gram',
  ...ARABIC_GRAM_UNITS,
]);

export const MILLIGRAM_UNITS: ReadonlySet<string> = new Set([
  'mg',
  ...ARABIC_MILLIGRAM_UNITS,
]);

// Units only a serving or package size is read in.
export const QUANTITY_UNITS: Readonly<Record<string, QuantityUnit>> = {
  kg: 'kg',
  كجم: 'kg',
  كغ: 'kg',
  ml: 'ml',
  مل: 'ml',
  ملل: 'ml',
  مليلتر: 'ml',
  ملليلتر: 'ml',
  l: 'l',
  ltr: 'l',
  لتر: 'l',
  cl: 'cl',
};

// Arabic unit and basis words a heading's number is printed against: the
// words above that are Arabic, and "كيلو" (kilo-), which starts two-word units.
export const ARABIC_UNIT_WORDS: ReadonlySet<string> = new Set([
  ...ARABIC_GRAM_UNITS,
  ...ARABIC_MILLIGRAM_UNITS,
  ...Object.keys(QUANTITY_UNITS).filter((unit) => /[ء-ي]/.test(unit)),
  'كيلو',
]);

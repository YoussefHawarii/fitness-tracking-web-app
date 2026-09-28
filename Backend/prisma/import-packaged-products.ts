// Reusable, provider-agnostic import path for the local packaged-product
// catalog: Dataset -> Parser -> Normalize -> Validate -> Deduplicate by
// barcode -> Upsert -> PostgreSQL. Accepts CSV or JSON; not wired to any
// specific dataset — this app does not ship or auto-import one (per the
// Egyptian-catalog spec: "only provide the mechanism unless a dataset is
// already included/approved"). Run manually:
//
//   npx ts-node prisma/import-packaged-products.ts <path/to/file.csv|.json>
//
// Existing barcodes are left untouched (skipped, not overwritten) — this
// mechanism is for filling gaps, not for a provider to silently replace
// locally-verified or user-submitted data.
import * as fs from 'fs';
import * as path from 'path';
import {
  BaseUnit,
  ContainerKey,
  PrismaClient,
  ProductSource,
  VerificationStatus,
} from '@prisma/client';
import { parseCsv } from './egyptian-food-catalog';
import { normalizeBarcode } from '../src/modules/food/barcode-normalizer';
import {
  normalizeMeasurement,
  normalizeUnitToken,
} from '../src/modules/food/unit-normalizer';

export interface PackagedProductImportRecord {
  barcode: string;
  name: string;
  nameAr: string | null;
  brand: string | null;
  category: string | null;
  servingSize: number | null;
  servingUnit: string | null;
  servingBaseUnit: BaseUnit | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageBaseUnit: BaseUnit | null;
  containerKey: ContainerKey;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  sodiumPer100g: number | null;
  imageUrl: string | null;
  country: string | null;
  unrecognizedUnitTokens: string[];
}

const REQUIRED_NUMERIC_FIELDS = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'fatPer100g',
] as const;
const OPTIONAL_NUMERIC_FIELDS = [
  'fiberPer100g',
  'sugarPer100g',
  'sodiumPer100g',
] as const;
const OPTIONAL_STRING_FIELDS = [
  'nameAr',
  'brand',
  'category',
  'imageUrl',
  'country',
] as const;

function toNumber(value: unknown, field: string, index: number): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(
      `record ${index}: "${field}" is not a valid number (got ${JSON.stringify(value)})`,
    );
  }
  if (n < 0) {
    throw new Error(`record ${index}: "${field}" cannot be negative`);
  }
  return n;
}

function toOptionalNumber(
  value: unknown,
  field: string,
  index: number,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return toNumber(value, field, index);
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Validates and normalizes one raw record (already split into fields, from
// either CSV or JSON) into a PackagedProductImportRecord. Throws with a
// specific, actionable message on the first problem found — an import run is
// expected to be re-run after fixing the source file, not partially applied
// with silently-skipped bad rows.
function toImportRecord(
  raw: Record<string, unknown>,
  index: number,
): PackagedProductImportRecord {
  const rawBarcode = raw.barcode;
  if (typeof rawBarcode !== 'string' || rawBarcode.trim() === '') {
    throw new Error(`record ${index}: missing "barcode"`);
  }
  const normalized = normalizeBarcode(rawBarcode);
  if (!normalized) {
    throw new Error(
      `record ${index}: "${rawBarcode}" is not a valid EAN-13/EAN-8/UPC-A/UPC-E barcode`,
    );
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    throw new Error(`record ${index}: missing "name"`);
  }

  const record: PackagedProductImportRecord = {
    barcode: normalized.canonical,
    name,
    nameAr: null,
    brand: null,
    category: null,
    servingSize: null,
    servingUnit: null,
    servingBaseUnit: null,
    packageSize: null,
    packageUnit: null,
    packageBaseUnit: null,
    containerKey: ContainerKey.PACKAGE,
    caloriesPer100g: 0,
    proteinPer100g: 0,
    carbsPer100g: 0,
    fatPer100g: 0,
    fiberPer100g: null,
    sugarPer100g: null,
    sodiumPer100g: null,
    imageUrl: null,
    country: null,
    unrecognizedUnitTokens: [],
  };

  for (const field of REQUIRED_NUMERIC_FIELDS) {
    record[field] = toNumber(raw[field], field, index);
  }
  for (const field of OPTIONAL_NUMERIC_FIELDS) {
    record[field] = toOptionalNumber(raw[field], field, index);
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    record[field] = toOptionalString(raw[field]);
  }

  const rawServingSize = toOptionalNumber(
    raw.servingSize,
    'servingSize',
    index,
  );
  const rawServingUnit = toOptionalString(raw.servingUnit);
  const serving = normalizeMeasurement(rawServingSize, rawServingUnit);
  record.servingSize = serving?.value ?? null;
  record.servingUnit = serving?.legacyUnit ?? null;
  record.servingBaseUnit = serving?.baseUnit ?? null;
  if (
    rawServingSize !== null &&
    rawServingUnit !== null &&
    normalizeMeasurement(1, rawServingUnit) === null
  ) {
    const token = normalizeUnitToken(rawServingUnit);
    if (token !== null) record.unrecognizedUnitTokens.push(token);
  }

  const rawPackageSize = toOptionalNumber(
    raw.packageSize,
    'packageSize',
    index,
  );
  const rawPackageUnit = toOptionalString(raw.packageUnit);
  const packageMeasurement = normalizeMeasurement(
    rawPackageSize,
    rawPackageUnit,
  );
  record.packageSize = packageMeasurement?.value ?? null;
  record.packageUnit = packageMeasurement?.legacyUnit ?? null;
  record.packageBaseUnit = packageMeasurement?.baseUnit ?? null;
  if (
    rawPackageSize !== null &&
    rawPackageUnit !== null &&
    normalizeMeasurement(1, rawPackageUnit) === null
  ) {
    const token = normalizeUnitToken(rawPackageUnit);
    if (token !== null) record.unrecognizedUnitTokens.push(token);
  }

  if (raw.containerKey !== undefined && raw.containerKey !== null) {
    if (typeof raw.containerKey !== 'string') {
      throw new Error(`record ${index}: "containerKey" must be a string`);
    }
    const containerKey = raw.containerKey.trim().toUpperCase();
    if (!Object.values(ContainerKey).includes(containerKey as ContainerKey)) {
      throw new Error(
        `record ${index}: "containerKey" is not a recognized container key`,
      );
    }
    record.containerKey = containerKey as ContainerKey;
  }

  return record;
}

function deduplicateByBarcode(
  records: PackagedProductImportRecord[],
): PackagedProductImportRecord[] {
  const seen = new Map<string, number>();
  records.forEach((r, i) => {
    if (seen.has(r.barcode)) {
      throw new Error(
        `duplicate barcode "${r.barcode}" at records ${seen.get(r.barcode)} and ${i} within the same import file`,
      );
    }
    seen.set(r.barcode, i);
  });
  return records;
}

export function parsePackagedProductRecords(
  text: string,
  format: 'csv' | 'json',
): PackagedProductImportRecord[] {
  if (format === 'json') {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON import must be an array of product records');
    }
    return deduplicateByBarcode(
      parsed.map((raw, i) => toImportRecord(raw as Record<string, unknown>, i)),
    );
  }

  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('CSV file is empty');
  const header = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  const records = dataRows.map((row, i) => {
    const raw: Record<string, unknown> = {};
    header.forEach((col, colIndex) => {
      raw[col.trim()] = row[colIndex];
    });
    return toImportRecord(raw, i);
  });
  return deduplicateByBarcode(records);
}

export async function importPackagedProducts(
  records: PackagedProductImportRecord[],
  prisma: PrismaClient,
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const record of records) {
    const existing = await prisma.packagedProduct.findUnique({
      where: { barcode: record.barcode },
    });
    if (existing) {
      // Never overwrite an already-known product (Open Food Facts cache hit,
      // a user submission, or a prior import) with dataset data of unknown
      // relative quality.
      skipped++;
      continue;
    }
    const { unrecognizedUnitTokens, ...data } = record;
    void unrecognizedUnitTokens;
    await prisma.packagedProduct.create({
      data: {
        ...data,
        source: ProductSource.ADMIN,
        sourceId: null,
        verificationStatus: VerificationStatus.EXTERNAL,
      },
    });
    created++;
  }
  return { created, skipped };
}

export function countUnrecognizedUnitTokens(
  records: PackagedProductImportRecord[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of records.flatMap(
    (record) => record.unrecognizedUnitTokens,
  )) {
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}

export function formatUnrecognizedUnitTokens(
  counts: Record<string, number>,
): string {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return entries.length === 0
    ? '(none)'
    : entries.map(([token, count]) => `${token} → ${count}`).join(', ');
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      'Usage: npx ts-node prisma/import-packaged-products.ts <path/to/file.csv|.json>',
    );
    process.exitCode = 1;
    return;
  }
  const format =
    path.extname(filePath).toLowerCase() === '.json' ? 'json' : 'csv';
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const records = parsePackagedProductRecords(text, format);

  const prisma = new PrismaClient();
  try {
    const { created, skipped } = await importPackagedProducts(records, prisma);
    console.log(
      `Imported ${created} new packaged product(s); skipped ${skipped} already-known barcode(s).`,
    );
    console.log(
      `Unrecognized unit tokens left absent: ${formatUnrecognizedUnitTokens(
        countUnrecognizedUnitTokens(records),
      )}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// Idempotently converts legacy PackagedProduct size/unit pairs into Base-unit
// values while retaining the lowercase legacy unit strings for tolerant
// readers. Unsupported or incomplete metadata is preserved verbatim and its
// Base unit is explicitly left absent rather than guessed.
//
// Run from Backend/ against the database selected by DATABASE_URL:
//
//   npm run db:normalize-product-units -- --dry-run
//   npm run db:normalize-product-units
//   npm run db:normalize-product-units -- --verify
import * as fs from 'fs';
import * as path from 'path';
import { BaseUnit, Prisma, PrismaClient } from '@prisma/client';
import {
  normalizeMeasurement,
  normalizeUnitToken,
} from '../src/modules/food/unit-normalizer';

export type CliMode =
  { kind: 'normalize'; dryRun: boolean } | { kind: 'verify' };

export class CliUsageError extends Error {}

export interface NormalizationCounts {
  total: number;
  changedRows: number;
  packageNormalized: number;
  servingNormalized: number;
  packageIntentionallyAbsent: number;
  servingIntentionallyAbsent: number;
  emptyPairs: number;
  unrecognizedUnitTokens: Record<string, number>;
}

export interface VerifyReport {
  total: number;
  usableWithoutBaseUnit: string[];
  unusableWithBaseUnit: string[];
  normalizedMismatch: string[];
}

interface ProductUnitRow {
  id: string;
  packageSize: unknown;
  packageUnit: string | null;
  packageBaseUnit: BaseUnit | null;
  servingSize: unknown;
  servingUnit: string | null;
  servingBaseUnit: BaseUnit | null;
}

const PRODUCT_UNIT_SELECT = {
  id: true,
  packageSize: true,
  packageUnit: true,
  packageBaseUnit: true,
  servingSize: true,
  servingUnit: true,
  servingBaseUnit: true,
} as const;

const USAGE = [
  'Usage (from Backend/):',
  '  npm run db:normalize-product-units -- [--dry-run]',
  '  npm run db:normalize-product-units -- --verify',
].join('\n');

export function parseCliArgs(args: string[]): CliMode {
  let verify = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--verify') {
      if (verify)
        throw new CliUsageError('--verify may only be supplied once.');
      verify = true;
    } else if (arg === '--dry-run') {
      if (dryRun) {
        throw new CliUsageError('--dry-run may only be supplied once.');
      }
      dryRun = true;
    } else {
      throw new CliUsageError(`Unknown argument: ${arg}.`);
    }
  }
  if (verify && dryRun) {
    throw new CliUsageError('--dry-run cannot be combined with --verify.');
  }
  return verify ? { kind: 'verify' } : { kind: 'normalize', dryRun };
}

// Host only: credentials and query parameters are never printed.
export function databaseHostLabel(): string {
  let url = process.env.DATABASE_URL;
  if (!url) {
    try {
      const line = fs
        .readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
        .split(/\r?\n/)
        .find((candidate) => candidate.startsWith('DATABASE_URL='));
      url = line
        ?.slice('DATABASE_URL='.length)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    } catch {
      url = undefined;
    }
  }
  if (!url) return '(from Backend/.env)';
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

export function decimalEquals(left: unknown, right: unknown): boolean {
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  ) {
    return false;
  }
  const decimalString = (value: unknown): string | null => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    if (value instanceof Prisma.Decimal) return value.toString();
    return null;
  };
  const leftString = decimalString(left);
  const rightString = decimalString(right);
  if (leftString === null || rightString === null) return false;
  try {
    return new Prisma.Decimal(leftString).equals(
      new Prisma.Decimal(rightString),
    );
  } catch {
    return false;
  }
}

function dimensionUpdate(
  row: ProductUnitRow,
  dimension: 'package' | 'serving',
): {
  normalized: boolean;
  intentionallyAbsent: boolean;
  data: Record<string, unknown>;
} {
  const size = dimension === 'package' ? row.packageSize : row.servingSize;
  const unit = dimension === 'package' ? row.packageUnit : row.servingUnit;
  const baseUnit =
    dimension === 'package' ? row.packageBaseUnit : row.servingBaseUnit;
  const normalized = normalizeMeasurement(size, unit);
  const baseField = `${dimension}BaseUnit`;

  if (!normalized) {
    return {
      normalized: false,
      intentionallyAbsent: true,
      data: baseUnit === null ? {} : { [baseField]: null },
    };
  }

  const sizeField = `${dimension}Size`;
  const unitField = `${dimension}Unit`;
  const agrees =
    decimalEquals(size, normalized.value) &&
    unit === normalized.legacyUnit &&
    baseUnit === normalized.baseUnit;
  return {
    normalized: !agrees,
    intentionallyAbsent: false,
    data: agrees
      ? {}
      : {
          [sizeField]: new Prisma.Decimal(String(normalized.value)),
          [unitField]: normalized.legacyUnit,
          [baseField]: normalized.baseUnit,
        },
  };
}

function recordPairDiagnostics(
  counts: NormalizationCounts,
  size: unknown,
  unit: string | null,
): void {
  const token = normalizeUnitToken(unit);
  if ((size === null || size === undefined) && token === null) {
    counts.emptyPairs++;
    return;
  }
  if (token !== null && normalizeMeasurement(1, token) === null) {
    counts.unrecognizedUnitTokens[token] =
      (counts.unrecognizedUnitTokens[token] ?? 0) + 1;
  }
}

export async function normalizeProductUnits(
  prisma: PrismaClient,
  options?: { dryRun?: boolean },
): Promise<NormalizationCounts> {
  const rows = (await prisma.packagedProduct.findMany({
    select: PRODUCT_UNIT_SELECT,
  })) as ProductUnitRow[];
  const counts: NormalizationCounts = {
    total: rows.length,
    changedRows: 0,
    packageNormalized: 0,
    servingNormalized: 0,
    packageIntentionallyAbsent: 0,
    servingIntentionallyAbsent: 0,
    emptyPairs: 0,
    unrecognizedUnitTokens: {},
  };

  for (const row of rows) {
    recordPairDiagnostics(counts, row.packageSize, row.packageUnit);
    recordPairDiagnostics(counts, row.servingSize, row.servingUnit);
    const packageResult = dimensionUpdate(row, 'package');
    const servingResult = dimensionUpdate(row, 'serving');
    if (packageResult.normalized) counts.packageNormalized++;
    if (servingResult.normalized) counts.servingNormalized++;
    if (packageResult.intentionallyAbsent) {
      counts.packageIntentionallyAbsent++;
    }
    if (servingResult.intentionallyAbsent) {
      counts.servingIntentionallyAbsent++;
    }
    const data = { ...packageResult.data, ...servingResult.data };
    if (Object.keys(data).length === 0) continue;
    counts.changedRows++;
    if (!options?.dryRun) {
      await prisma.packagedProduct.update({
        where: { id: row.id },
        data,
      });
    }
  }
  return counts;
}

function verifyDimension(
  row: ProductUnitRow,
  dimension: 'package' | 'serving',
  report: VerifyReport,
): void {
  const size = dimension === 'package' ? row.packageSize : row.servingSize;
  const unit = dimension === 'package' ? row.packageUnit : row.servingUnit;
  const baseUnit =
    dimension === 'package' ? row.packageBaseUnit : row.servingBaseUnit;
  const normalized = normalizeMeasurement(size, unit);
  const reference = `${row.id}:${dimension}`;

  if (!normalized) {
    if (baseUnit !== null) report.unusableWithBaseUnit.push(reference);
    return;
  }
  if (baseUnit === null) {
    report.usableWithoutBaseUnit.push(reference);
    return;
  }
  if (
    baseUnit !== normalized.baseUnit ||
    unit !== normalized.legacyUnit ||
    !decimalEquals(size, normalized.value)
  ) {
    report.normalizedMismatch.push(reference);
  }
}

export async function verifyProductUnits(
  prisma: PrismaClient,
): Promise<VerifyReport> {
  const rows = (await prisma.packagedProduct.findMany({
    select: PRODUCT_UNIT_SELECT,
  })) as ProductUnitRow[];
  const report: VerifyReport = {
    total: rows.length,
    usableWithoutBaseUnit: [],
    unusableWithBaseUnit: [],
    normalizedMismatch: [],
  };
  for (const row of rows) {
    verifyDimension(row, 'package', report);
    verifyDimension(row, 'serving', report);
  }
  return report;
}

export function distinctViolationCount(report: VerifyReport): number {
  return new Set([
    ...report.usableWithoutBaseUnit,
    ...report.unusableWithBaseUnit,
    ...report.normalizedMismatch,
  ]).size;
}

function printViolationReferences(label: string, references: string[]): void {
  if (references.length === 0) return;
  console.log(`  ${label} references:`);
  for (const reference of references.slice(0, 50)) {
    console.log(`    ${reference}`);
  }
  if (references.length > 50) {
    console.log(`    +${references.length - 50} more`);
  }
}

export function printVerifyReport(report: VerifyReport): void {
  console.log(`Checked ${report.total} packaged product row(s).`);
  console.log(
    `  usable pair without Base unit: ${report.usableWithoutBaseUnit.length}`,
  );
  console.log(
    `  unusable pair with Base unit: ${report.unusableWithBaseUnit.length}`,
  );
  console.log(`  normalized mismatch: ${report.normalizedMismatch.length}`);
  console.log(`  distinct violations: ${distinctViolationCount(report)}`);
  printViolationReferences(
    'usable pair without Base unit',
    report.usableWithoutBaseUnit,
  );
  printViolationReferences(
    'unusable pair with Base unit',
    report.unusableWithBaseUnit,
  );
  printViolationReferences('normalized mismatch', report.normalizedMismatch);
}

function printAbsenceSummary(counts: NormalizationCounts): void {
  const tokenCounts = Object.entries(counts.unrecognizedUnitTokens).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  console.log(`  empty pairs: ${counts.emptyPairs}.`);
  console.log(
    `  unrecognized unit tokens: ${
      tokenCounts.length === 0
        ? '(none)'
        : tokenCounts.map(([token, count]) => `${token} → ${count}`).join(', ')
    }.`,
  );
}

async function main(): Promise<void> {
  let mode: CliMode;
  try {
    mode = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  console.log(`Target database host: ${databaseHostLabel()}.`);
  const prisma = new PrismaClient();
  try {
    if (mode.kind === 'verify') {
      const report = await verifyProductUnits(prisma);
      printVerifyReport(report);
      if (distinctViolationCount(report) > 0) {
        console.error('Verify failed: product-unit violations remain.');
        process.exitCode = 1;
      } else {
        console.log('Verify passed: no product-unit violations.');
      }
      return;
    }

    const counts = await normalizeProductUnits(prisma, {
      dryRun: mode.dryRun,
    });
    const action = mode.dryRun ? 'would change' : 'changed';
    console.log(
      `${mode.dryRun ? 'Dry run: ' : ''}${counts.total} row(s) checked; ` +
        `${counts.changedRows} ${action}.`,
    );
    console.log(
      `  package normalized: ${counts.packageNormalized}; serving normalized: ${counts.servingNormalized}.`,
    );
    console.log(
      `  intentionally absent: ${counts.packageIntentionallyAbsent} package, ${counts.servingIntentionallyAbsent} serving.`,
    );
    printAbsenceSummary(counts);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

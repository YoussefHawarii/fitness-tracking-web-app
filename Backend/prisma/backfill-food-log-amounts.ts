// One-off backfill for the explicit food-log amount columns: copies
// `grams` into `amount` (`amountUnit = G`, `portionKind = null`) on rows
// written before dual-write existed, then proves it with verify mode.
// Historical amounts meant grams when written and stay MASS/g forever —
// nothing here reinterprets a value as millilitres.
//
// It uses whatever DATABASE_URL resolves to (`Backend/.env`, the local
// Docker database, by default). Run from `Backend/`:
//
//   npx ts-node prisma/backfill-food-log-amounts.ts [--dry-run]   # backfill (default)
//   npx ts-node prisma/backfill-food-log-amounts.ts --verify      # report violations, non-zero exit when any exist
//   npx ts-node prisma/backfill-food-log-amounts.ts --snapshot <file.json>
//   npx ts-node prisma/backfill-food-log-amounts.ts --compare <file.json>
//
// A production run is a deliberate step, documented in
// specs/009-barcode-portion-logging/backfill-runbook.md. The Prisma client
// reads DATABASE_URL from the environment like every other Prisma script.
import * as fs from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';

export interface BackfillCounts {
  total: number;
  nullAmount: number;
  updated: number;
  unbackfillable: number;
  nullAmountAfter: number;
}

export interface FoodLogAmountCounts {
  total: number;
  nullAmount: number;
  candidates: number;
  unbackfillable: number;
}

export interface VerifyReport {
  total: number;
  nullAmount: string[];
  nullUnit: string[];
  gramsMismatch: string[];
  invalidMl: string[];
}

export interface NutritionSnapshotEntry {
  id: string;
  caloriesComputed: string | null;
  proteinComputed: string | null;
  carbsComputed: string | null;
  fatComputed: string | null;
}

export interface SnapshotDiff {
  missing: string[];
  extra: string[];
  changed: {
    id: string;
    field: string;
    expected: string | null;
    actual: string | null;
  }[];
}

export type CliMode =
  | { kind: 'backfill'; dryRun: boolean }
  | { kind: 'verify' }
  | { kind: 'snapshot'; file: string }
  | { kind: 'compare'; file: string };

export class CliUsageError extends Error {}

const USAGE = [
  'Usage (from Backend/):',
  '  npx ts-node prisma/backfill-food-log-amounts.ts [--dry-run]',
  '  npx ts-node prisma/backfill-food-log-amounts.ts --verify',
  '  npx ts-node prisma/backfill-food-log-amounts.ts --snapshot <file.json>',
  '  npx ts-node prisma/backfill-food-log-amounts.ts --compare <file.json>',
].join('\n');

// Parses argv (without node/script entries) into a single mode. Anything
// ambiguous is rejected: an unknown flag, a missing file operand, more than
// one mode, or --dry-run outside backfill. Strictness here keeps a typo from
// falling through into a write.
export function parseCliArgs(args: string[]): CliMode {
  let mode: 'verify' | 'snapshot' | 'compare' | null = null;
  let file = '';
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (
      arg === '--verify' ||
      arg === '--snapshot' ||
      arg === '--compare'
    ) {
      if (mode !== null) {
        throw new CliUsageError(
          'Only one mode is allowed: --verify, --snapshot <file> or --compare <file>.',
        );
      }
      if (arg === '--verify') {
        mode = 'verify';
      } else {
        const operand = args[i + 1];
        if (operand === undefined || operand.startsWith('-')) {
          throw new CliUsageError(
            `Missing file operand for ${arg}: expected ${arg} <file.json>.`,
          );
        }
        mode = arg === '--snapshot' ? 'snapshot' : 'compare';
        file = operand;
        i++;
      }
    } else {
      throw new CliUsageError(`Unknown argument: ${arg}.`);
    }
  }
  if (mode === null) return { kind: 'backfill', dryRun };
  if (dryRun) {
    throw new CliUsageError(
      '--dry-run only applies to the default backfill mode.',
    );
  }
  if (mode === 'verify') return { kind: 'verify' };
  return { kind: mode, file };
}

// Host of the target database for the target confirmation line. Host
// only — never the user, password or full URL.
export function databaseHostLabel(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return '(from Backend/.env)';
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

// String form of a Decimal-backed value without any float conversion.
// Only string, number, bigint, boolean and Prisma.Decimal are expected (the
// shapes this column actually takes); anything else throws rather than
// silently serializing to "[object Object]".
function decimalToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Prisma.Decimal) return value.toString();
  throw new Error(
    `Cannot compare a food log amount of unexpected type ${typeof value}`,
  );
}

// Numeric equality for Decimal-backed values: both sides go through their
// string form into Prisma.Decimal, so a value like "123.456789" keeps its
// precision exactly. Falls back to plain string comparison when a side is
// not Decimal-parseable.
export function decimalEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }
  try {
    const left = decimalToString(a);
    const right = decimalToString(b);
    try {
      return new Prisma.Decimal(left).equals(new Prisma.Decimal(right));
    } catch {
      return left === right;
    }
  } catch {
    return a === b;
  }
}

function serializeDecimal(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Prisma.Decimal) return value.toString();
  throw new Error(
    `Cannot snapshot computed nutrition of unexpected type ${typeof value}`,
  );
}

// The write itself, isolated so tests can assert its exact statement: one
// atomic conditional UPDATE that copies the stored Decimal verbatim, so
// precision is exact and Postgres re-checks the predicate at write time
// (race-free against concurrent writers). Returns the affected-row count.
export async function copyGramsToAmount(prisma: PrismaClient): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "food_log_entries"
    SET "amount" = "grams",
      "amountUnit" = 'G'::"BaseUnit",
      "portionKind" = NULL
    WHERE "amount" IS NULL AND "grams" IS NOT NULL`;
}

export async function countFoodLogAmounts(
  prisma: PrismaClient,
): Promise<FoodLogAmountCounts> {
  const [counts] = await prisma.$queryRaw<
    { total: number; nullAmount: number; candidates: number }[]
  >`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "amount" IS NULL)::int AS "nullAmount",
      count(*) FILTER (WHERE "amount" IS NULL AND "grams" IS NOT NULL)::int AS candidates
    FROM "food_log_entries"`;
  if (!counts) throw new Error('Aggregate food log counts returned no row.');
  return {
    ...counts,
    unbackfillable: counts.nullAmount - counts.candidates,
  };
}

// Idempotent backfill: the UPDATE only matches rows with `amount IS NULL`
// and `grams IS NOT NULL`, so re-running it affects 0 rows. Rows with both
// fields null cannot be backfilled — inventing a value would corrupt
// history — so they are counted and left for verify mode to report. With
// `dryRun` nothing is written; `updated` then reports the candidate count.
export async function backfillFoodLogAmounts(
  prisma: PrismaClient,
  options?: { dryRun?: boolean },
): Promise<BackfillCounts> {
  const before = await countFoodLogAmounts(prisma);
  if (options?.dryRun) {
    return {
      total: before.total,
      nullAmount: before.nullAmount,
      updated: before.candidates,
      unbackfillable: before.unbackfillable,
      nullAmountAfter: before.nullAmount,
    };
  }
  const updated = await copyGramsToAmount(prisma);
  const after = await countFoodLogAmounts(prisma);
  return {
    total: before.total,
    nullAmount: before.nullAmount,
    updated,
    unbackfillable: before.unbackfillable,
    nullAmountAfter: after.nullAmount,
  };
}

// Verify mode: reports every row that would block the contract step. An ML
// row is valid when `amount` is set and `grams` is null — millilitres live
// only in `amount`, so it is never compared against grams.
export async function verifyFoodLogAmounts(
  prisma: PrismaClient,
): Promise<VerifyReport> {
  // Full-table reads are accepted because the table is small; pagination is the upgrade path if it grows.
  const rows = await prisma.foodLogEntry.findMany({
    select: { id: true, grams: true, amount: true, amountUnit: true },
  });
  const report: VerifyReport = {
    total: rows.length,
    nullAmount: [],
    nullUnit: [],
    gramsMismatch: [],
    invalidMl: [],
  };
  for (const row of rows) {
    if (row.amount === null) report.nullAmount.push(row.id);
    if (row.amountUnit === null) report.nullUnit.push(row.id);
    if (row.amountUnit === 'G' && !decimalEquals(row.amount, row.grams)) {
      report.gramsMismatch.push(row.id);
    }
    if (
      row.amountUnit === 'ML' &&
      (row.amount === null || row.grams !== null)
    ) {
      report.invalidMl.push(row.id);
    }
  }
  return report;
}

// One row can appear in several violation classes, so the exit decision
// rests on the number of DISTINCT violating rows, not the class total.
export function distinctViolationCount(report: VerifyReport): number {
  return new Set([
    ...report.nullAmount,
    ...report.nullUnit,
    ...report.gramsMismatch,
    ...report.invalidMl,
  ]).size;
}

// Reads the computed nutrition of every entry with Decimals serialized as
// strings, so a snapshot round-trips through JSON without precision loss.
export async function readNutritionSnapshot(
  prisma: PrismaClient,
): Promise<NutritionSnapshotEntry[]> {
  const rows = await prisma.foodLogEntry.findMany({
    select: {
      id: true,
      caloriesComputed: true,
      proteinComputed: true,
      carbsComputed: true,
      fatComputed: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    caloriesComputed: serializeDecimal(row.caloriesComputed),
    proteinComputed: serializeDecimal(row.proteinComputed),
    carbsComputed: serializeDecimal(row.carbsComputed),
    fatComputed: serializeDecimal(row.fatComputed),
  }));
}

// Re-reads the same fields and reports any entry whose computed values
// differ, that vanished since the snapshot (`missing`), or that appeared
// since (`extra`). The backfill must not change computed nutrition, so any
// entry in any of these lists fails the comparison.
export async function compareNutritionSnapshot(
  prisma: PrismaClient,
  expected: NutritionSnapshotEntry[],
): Promise<SnapshotDiff> {
  const live = await readNutritionSnapshot(prisma);
  const liveById = new Map(live.map((row) => [row.id, row]));
  const expectedById = new Map(expected.map((row) => [row.id, row]));
  const diff: SnapshotDiff = { missing: [], extra: [], changed: [] };

  for (const row of expected) {
    const current = liveById.get(row.id);
    if (!current) {
      diff.missing.push(row.id);
      continue;
    }
    for (const field of [
      'caloriesComputed',
      'proteinComputed',
      'carbsComputed',
      'fatComputed',
    ] as const) {
      if (current[field] !== row[field]) {
        diff.changed.push({
          id: row.id,
          field,
          expected: row[field],
          actual: current[field],
        });
      }
    }
  }
  for (const row of live) {
    if (!expectedById.has(row.id)) diff.extra.push(row.id);
  }
  return diff;
}

function printVerifyReport(report: VerifyReport): void {
  console.log(`Checked ${report.total} food log entr(y/ies).`);
  console.log(`  null amount: ${report.nullAmount.length}`);
  console.log(`  null amountUnit: ${report.nullUnit.length}`);
  console.log(`  G amount <> grams: ${report.gramsMismatch.length}`);
  console.log(`  invalid ML: ${report.invalidMl.length}`);
  console.log(`  distinct violating rows: ${distinctViolationCount(report)}`);
  const examples: Record<string, string[]> = {
    'null amount': report.nullAmount,
    'null amountUnit': report.nullUnit,
    'G amount <> grams': report.gramsMismatch,
    'invalid ML': report.invalidMl,
  };
  for (const [label, ids] of Object.entries(examples)) {
    if (ids.length > 0) {
      console.log(`  e.g. ${label}: ${ids.slice(0, 20).join(', ')}`);
    }
  }
}

async function main() {
  let mode: CliMode;
  try {
    mode = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(err.message);
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  console.log(`Target database host: ${databaseHostLabel()}.`);
  const prisma = new PrismaClient();
  try {
    if (mode.kind === 'verify') {
      const report = await verifyFoodLogAmounts(prisma);
      printVerifyReport(report);
      if (distinctViolationCount(report) > 0) {
        console.error('Verify failed: violations remain.');
        process.exitCode = 1;
      } else {
        console.log('Verify passed: no violations.');
      }
      return;
    }

    if (mode.kind === 'snapshot') {
      const snapshot = await readNutritionSnapshot(prisma);
      fs.writeFileSync(mode.file, JSON.stringify(snapshot, null, 2));
      console.log(
        `Snapshot of ${snapshot.length} entr(y/ies) written to ${mode.file}.`,
      );
      return;
    }

    if (mode.kind === 'compare') {
      const expected = JSON.parse(
        fs.readFileSync(mode.file, 'utf8'),
      ) as NutritionSnapshotEntry[];
      const diff = await compareNutritionSnapshot(prisma, expected);
      const total =
        diff.missing.length + diff.extra.length + diff.changed.length;
      console.log(
        `Compared ${expected.length} snapshot entr(y/ies): ` +
          `${diff.changed.length} changed, ${diff.missing.length} missing, ${diff.extra.length} extra.`,
      );
      for (const id of diff.missing.slice(0, 20)) {
        console.log(`  missing: ${id}`);
      }
      for (const id of diff.extra.slice(0, 20)) {
        console.log(`  extra: ${id}`);
      }
      for (const change of diff.changed.slice(0, 20)) {
        console.log(
          `  changed: ${change.id} ${change.field} expected=${change.expected} actual=${change.actual}`,
        );
      }
      if (total > 0) {
        console.error(
          'Compare failed: computed nutrition differs from snapshot.',
        );
        process.exitCode = 1;
      } else {
        console.log('Compare passed: computed nutrition unchanged.');
      }
      return;
    }

    const result = await backfillFoodLogAmounts(prisma, {
      dryRun: mode.dryRun,
    });
    if (mode.dryRun) {
      console.log(
        `Dry run: ${result.total} total, ${result.nullAmount} with null amount, ` +
          `${result.updated} would be backfilled, ${result.unbackfillable} unbackfillable (amount and grams both null).`,
      );
      return;
    }
    console.log(
      `Backfilled ${result.updated} of ${result.total} entr(y/ies) ` +
        `(${result.nullAmount} had null amount; ${result.unbackfillable} unbackfillable). ` +
        `${result.nullAmountAfter} still have null amount.`,
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

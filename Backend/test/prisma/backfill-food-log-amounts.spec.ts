import { Prisma } from '@prisma/client';
import {
  CliUsageError,
  backfillFoodLogAmounts,
  compareNutritionSnapshot,
  countFoodLogAmounts,
  distinctViolationCount,
  parseCliArgs,
  readNutritionSnapshot,
  verifyFoodLogAmounts,
} from '../../prisma/backfill-food-log-amounts';

type DecimalValue = string | Prisma.Decimal;

interface FakeRow {
  id: string;
  sourceType: 'LOCAL' | 'PACKAGED_PRODUCT' | 'OPEN_FOOD_FACTS';
  packagedProductId: string | null;
  grams: DecimalValue | null;
  amount: DecimalValue | null;
  amountUnit: 'G' | 'ML' | null;
  portionKind: string | null;
  caloriesComputed: DecimalValue | null;
  proteinComputed: DecimalValue | null;
  carbsComputed: DecimalValue | null;
  fatComputed: DecimalValue | null;
}

type FakeSelect = Partial<Record<keyof FakeRow, boolean>>;

// Hand-written fake mirroring the script's real queries: $queryRaw aggregates
// the store, findMany honors select and returns detached rows, and $executeRaw
// applies exactly the backfill SQL's semantics and returns the affected count.
function makeFakePrisma(initial: FakeRow[]) {
  const store: FakeRow[] = initial.map((row) => ({ ...row }));
  const rawStatements: string[] = [];
  const rawQueries: string[] = [];

  const prisma = {
    $executeRaw: jest.fn(
      (
        statement: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<number> => {
        void values;
        rawStatements.push(statement.join('?'));
        let affected = 0;
        for (const row of store) {
          if (row.amount === null && row.grams !== null) {
            row.amount = row.grams;
            row.amountUnit = 'G';
            row.portionKind = null;
            affected++;
          }
        }
        return Promise.resolve(affected);
      },
    ),
    $queryRaw: jest.fn(
      (
        statement: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<
        { total: number; nullAmount: number; candidates: number }[]
      > => {
        void values;
        rawQueries.push(statement.join('?'));
        const nullAmount = store.filter((row) => row.amount === null).length;
        const candidates = store.filter(
          (row) => row.amount === null && row.grams !== null,
        ).length;
        return Promise.resolve([
          { total: store.length, nullAmount, candidates },
        ]);
      },
    ),
    foodLogEntry: {
      findMany: jest.fn(
        (args?: { select?: FakeSelect }): Promise<Partial<FakeRow>[]> =>
          Promise.resolve(
            store.map((row) => {
              if (!args?.select) return { ...row };
              return Object.fromEntries(
                Object.entries(args.select)
                  .filter(([, included]) => included)
                  .map(([field]) => [field, row[field as keyof FakeRow]]),
              );
            }),
          ),
      ),
    },
  };
  return { store, rawStatements, rawQueries, prisma };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function legacyRow(id: string, grams: string): FakeRow {
  return {
    id,
    sourceType: 'LOCAL',
    packagedProductId: null,
    grams,
    amount: null,
    amountUnit: null,
    portionKind: null,
    caloriesComputed: '100',
    proteinComputed: '5',
    carbsComputed: '10',
    fatComputed: '3',
  };
}

describe('backfillFoodLogAmounts', () => {
  it('backfills legacy rows with one statement and reports counts', async () => {
    const { prisma, rawStatements } = makeFakePrisma([
      legacyRow('a', '150'),
      legacyRow('b', '200.5'),
      {
        ...legacyRow('c', '50'),
        amount: '50',
        amountUnit: 'G',
      },
    ]);

    const result = await backfillFoodLogAmounts(prisma as never);

    expect(result).toEqual({
      total: 3,
      nullAmount: 2,
      updated: 2,
      unbackfillable: 0,
      nullAmountAfter: 0,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(rawStatements).toHaveLength(1);
  });

  it('backfills packaged-product orphans and legacy Open Food Facts rows', async () => {
    const { store, prisma } = makeFakePrisma([
      {
        ...legacyRow('packaged-orphan', '75'),
        sourceType: 'PACKAGED_PRODUCT',
        packagedProductId: null,
      },
      {
        ...legacyRow('legacy-off', '125'),
        sourceType: 'OPEN_FOOD_FACTS',
      },
    ]);

    const result = await backfillFoodLogAmounts(prisma as never);
    const report = await verifyFoodLogAmounts(prisma as never);

    expect(result.updated).toBe(2);
    expect(
      store.map(({ id, amount, amountUnit, packagedProductId }) => ({
        id,
        amount,
        amountUnit,
        packagedProductId,
      })),
    ).toEqual([
      {
        id: 'packaged-orphan',
        amount: '75',
        amountUnit: 'G',
        packagedProductId: null,
      },
      {
        id: 'legacy-off',
        amount: '125',
        amountUnit: 'G',
        packagedProductId: null,
      },
    ]);
    expect(distinctViolationCount(report)).toBe(0);
  });

  it('is idempotent: a second run updates 0 rows and changes nothing', async () => {
    const { store, prisma } = makeFakePrisma([
      legacyRow('a', '150'),
      legacyRow('b', '200.5'),
    ]);

    const first = await backfillFoodLogAmounts(prisma as never);
    const snapshotAfterFirst = JSON.stringify(store);
    const second = await backfillFoodLogAmounts(prisma as never);

    expect(first.updated).toBe(2);
    expect(second).toEqual({
      total: 2,
      nullAmount: 0,
      updated: 0,
      unbackfillable: 0,
      nullAmountAfter: 0,
    });
    expect(JSON.stringify(store)).toBe(snapshotAfterFirst);
  });

  it('writes exactly amount, amountUnit and portionKind via the conditional SQL', async () => {
    const { store, rawStatements, prisma } = makeFakePrisma([
      legacyRow('a', '150'),
    ]);

    await backfillFoodLogAmounts(prisma as never);

    expect(normalizeSql(rawStatements[0])).toBe(
      'UPDATE "food_log_entries" SET "amount" = "grams", "amountUnit" = \'G\'::"BaseUnit", "portionKind" = NULL WHERE "amount" IS NULL AND "grams" IS NOT NULL',
    );
    expect(store[0]).toEqual({
      id: 'a',
      sourceType: 'LOCAL',
      packagedProductId: null,
      grams: '150',
      amount: '150',
      amountUnit: 'G',
      portionKind: null,
      caloriesComputed: '100',
      proteinComputed: '5',
      carbsComputed: '10',
      fatComputed: '3',
    });
  });

  it('takes each count snapshot with the exact aggregate query', async () => {
    const { prisma, rawQueries } = makeFakePrisma([legacyRow('a', '150')]);

    const counts = await countFoodLogAmounts(prisma as never);

    expect(counts).toEqual({
      total: 1,
      nullAmount: 1,
      candidates: 1,
      unbackfillable: 0,
    });
    expect(rawQueries).toHaveLength(1);
    expect(normalizeSql(rawQueries[0])).toBe(
      'SELECT count(*)::int AS total, count(*) FILTER (WHERE "amount" IS NULL)::int AS "nullAmount", count(*) FILTER (WHERE "amount" IS NULL AND "grams" IS NOT NULL)::int AS candidates FROM "food_log_entries"',
    );
  });

  it('leaves dual-written rows untouched', async () => {
    const { store, prisma } = makeFakePrisma([
      { ...legacyRow('a', '150'), amount: '150', amountUnit: 'G' },
    ]);

    const result = await backfillFoodLogAmounts(prisma as never);

    expect(result.updated).toBe(0);
    expect(result.nullAmountAfter).toBe(0);
    expect(store[0].portionKind).toBeNull();
  });

  it('counts rows with both amount and grams null instead of inventing a value', async () => {
    const { store, prisma } = makeFakePrisma([
      { ...legacyRow('a', '150'), grams: null },
    ]);

    const result = await backfillFoodLogAmounts(prisma as never);

    expect(result).toEqual({
      total: 1,
      nullAmount: 1,
      updated: 0,
      unbackfillable: 1,
      nullAmountAfter: 1,
    });
    expect(store[0].amount).toBeNull();
  });

  it('preserves Decimal precision exactly with real Prisma.Decimal values', async () => {
    const { store, prisma } = makeFakePrisma([
      {
        ...legacyRow('a', '0'),
        grams: new Prisma.Decimal('123.456789'),
      },
    ]);

    const result = await backfillFoodLogAmounts(prisma as never);

    expect(result.updated).toBe(1);
    expect(store[0].amount).toBeInstanceOf(Prisma.Decimal);
    expect(String(store[0].amount)).toBe('123.456789');

    const report = await verifyFoodLogAmounts(prisma as never);
    expect(distinctViolationCount(report)).toBe(0);
  });

  it('handles an empty table', async () => {
    const { prisma } = makeFakePrisma([]);

    const result = await backfillFoodLogAmounts(prisma as never);
    const report = await verifyFoodLogAmounts(prisma as never);

    expect(result).toEqual({
      total: 0,
      nullAmount: 0,
      updated: 0,
      unbackfillable: 0,
      nullAmountAfter: 0,
    });
    expect(distinctViolationCount(report)).toBe(0);
  });

  it('dry-run reports the change without executing the write', async () => {
    const { store, prisma } = makeFakePrisma([legacyRow('a', '150')]);

    const result = await backfillFoodLogAmounts(prisma as never, {
      dryRun: true,
    });

    expect(result.updated).toBe(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(store[0].amount).toBeNull();
  });
});

describe('verifyFoodLogAmounts', () => {
  it('passes a clean table including a valid ML row', async () => {
    const { prisma } = makeFakePrisma([
      { ...legacyRow('g1', '150'), amount: '150', amountUnit: 'G' },
      {
        ...legacyRow('ml1', '330'),
        grams: null,
        amount: '330',
        amountUnit: 'ML',
      },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(distinctViolationCount(report)).toBe(0);
  });

  it('detects a null-amount row', async () => {
    const { prisma } = makeFakePrisma([legacyRow('a', '150')]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(report.nullAmount).toEqual(['a']);
    expect(distinctViolationCount(report)).toBe(1);
  });

  it('detects a G row whose amount differs from grams', async () => {
    const { prisma } = makeFakePrisma([
      { ...legacyRow('a', '150'), amount: '200', amountUnit: 'G' },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(report.gramsMismatch).toEqual(['a']);
  });

  it('flags a null amountUnit even when the amount is set', async () => {
    const { prisma } = makeFakePrisma([
      { ...legacyRow('a', '100'), amount: '100', amountUnit: null },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(report.nullUnit).toEqual(['a']);
    expect(report.nullAmount).toEqual([]);
    expect(report.gramsMismatch).toEqual([]);
    expect(distinctViolationCount(report)).toBe(1);
  });

  it('flags a G row with grams null', async () => {
    const { prisma } = makeFakePrisma([
      { ...legacyRow('a', '100'), grams: null, amount: '100', amountUnit: 'G' },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(report.gramsMismatch).toEqual(['a']);
    expect(distinctViolationCount(report)).toBe(1);
  });

  it('detects an invalid ML row but not a valid one', async () => {
    const { prisma } = makeFakePrisma([
      // ML with grams still set: millilitres must live in amount alone.
      { ...legacyRow('bad', '330'), amount: '330', amountUnit: 'ML' },
      {
        ...legacyRow('good', '0'),
        grams: null,
        amount: '330',
        amountUnit: 'ML',
      },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(report.invalidMl).toEqual(['bad']);
  });

  it('flags an ML row with both amount and grams null', async () => {
    const { prisma } = makeFakePrisma([
      { ...legacyRow('a', '0'), grams: null, amountUnit: 'ML' },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    expect(report.nullAmount).toEqual(['a']);
    expect(report.invalidMl).toEqual(['a']);
    expect(distinctViolationCount(report)).toBe(1);
  });

  it('counts distinct rows, not class entries, for the exit decision', async () => {
    const { prisma } = makeFakePrisma([
      { ...legacyRow('a', '0'), grams: null, amountUnit: 'ML' },
    ]);

    const report = await verifyFoodLogAmounts(prisma as never);

    const classTotal =
      report.nullAmount.length +
      report.nullUnit.length +
      report.gramsMismatch.length +
      report.invalidMl.length;
    expect(classTotal).toBe(2);
    expect(distinctViolationCount(report)).toBe(1);
  });
});

describe('parseCliArgs', () => {
  it('parses the default backfill, --dry-run, --verify and file modes', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'backfill', dryRun: false });
    expect(parseCliArgs(['--dry-run'])).toEqual({
      kind: 'backfill',
      dryRun: true,
    });
    expect(parseCliArgs(['--verify'])).toEqual({ kind: 'verify' });
    expect(parseCliArgs(['--snapshot', 's.json'])).toEqual({
      kind: 'snapshot',
      file: 's.json',
    });
    expect(parseCliArgs(['--compare', 's.json'])).toEqual({
      kind: 'compare',
      file: 's.json',
    });
  });

  it('rejects a typoed flag', () => {
    expect(() => parseCliArgs(['--verfy'])).toThrow(CliUsageError);
  });

  it('rejects a missing file operand', () => {
    expect(() => parseCliArgs(['--snapshot'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--compare'])).toThrow(CliUsageError);
  });

  it('rejects two modes', () => {
    expect(() => parseCliArgs(['--verify', '--snapshot', 's.json'])).toThrow(
      CliUsageError,
    );
    expect(() => parseCliArgs(['--verify', '--compare', 's.json'])).toThrow(
      CliUsageError,
    );
  });

  it('rejects --dry-run outside the default backfill mode', () => {
    expect(() => parseCliArgs(['--verify', '--dry-run'])).toThrow(
      CliUsageError,
    );
    expect(() => parseCliArgs(['--snapshot', 'f.json', '--dry-run'])).toThrow(
      CliUsageError,
    );
  });
});

describe('nutrition snapshot round-trip', () => {
  it('compare detects a changed caloriesComputed', async () => {
    const { store, prisma } = makeFakePrisma([legacyRow('a', '150')]);

    const snapshot = await readNutritionSnapshot(prisma as never);
    expect(snapshot[0]).toEqual({
      id: 'a',
      caloriesComputed: '100',
      proteinComputed: '5',
      carbsComputed: '10',
      fatComputed: '3',
    });

    store[0].caloriesComputed = '120';
    const diff = await compareNutritionSnapshot(prisma as never, snapshot);

    expect(diff.changed).toEqual([
      { id: 'a', field: 'caloriesComputed', expected: '100', actual: '120' },
    ]);
  });

  it('compare passes when nothing changed', async () => {
    const { prisma } = makeFakePrisma([legacyRow('a', '150')]);

    const snapshot = await readNutritionSnapshot(prisma as never);
    const diff = await compareNutritionSnapshot(prisma as never, snapshot);

    expect(diff).toEqual({ missing: [], extra: [], changed: [] });
  });
});

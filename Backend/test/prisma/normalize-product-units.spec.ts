import { BaseUnit, Prisma } from '@prisma/client';
import {
  CliUsageError,
  distinctViolationCount,
  normalizeProductUnits,
  parseCliArgs,
  printVerifyReport,
  verifyProductUnits,
} from '../../prisma/normalize-product-units';

interface FakeRow {
  id: string;
  packageSize: string | Prisma.Decimal | null;
  packageUnit: string | null;
  packageBaseUnit: BaseUnit | null;
  servingSize: string | Prisma.Decimal | null;
  servingUnit: string | null;
  servingBaseUnit: BaseUnit | null;
}

function row(id: string, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id,
    packageSize: null,
    packageUnit: null,
    packageBaseUnit: null,
    servingSize: null,
    servingUnit: null,
    servingBaseUnit: null,
    ...overrides,
  };
}

function makeFakePrisma(initial: FakeRow[]) {
  const store = initial.map((item) => ({ ...item }));
  const prisma = {
    packagedProduct: {
      findMany: jest.fn(() =>
        Promise.resolve(store.map((item) => ({ ...item }))),
      ),
      update: jest.fn(
        (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const target = store.find((item) => item.id === args.where.id);
          if (!target) throw new Error(`missing fake row ${args.where.id}`);
          Object.assign(target, args.data);
          return Promise.resolve({ ...target });
        },
      ),
    },
  };
  return { store, prisma };
}

describe('normalizeProductUnits', () => {
  it('normalizes usable pairs, clears only invalid Base units, and is idempotent', async () => {
    const { store, prisma } = makeFakePrisma([
      row('usable', {
        packageSize: '0.33',
        packageUnit: 'L',
        servingSize: '60000',
        servingUnit: 'mg',
      }),
      row('unusable', {
        packageSize: '1',
        packageUnit: 'oz',
        packageBaseUnit: BaseUnit.G,
        servingSize: '10',
        servingUnit: null,
      }),
    ]);

    const first = await normalizeProductUnits(prisma as never);
    const afterFirst = JSON.stringify(store);
    const second = await normalizeProductUnits(prisma as never);

    expect(first).toEqual({
      total: 2,
      changedRows: 2,
      packageNormalized: 1,
      servingNormalized: 1,
      packageIntentionallyAbsent: 1,
      servingIntentionallyAbsent: 1,
      emptyPairs: 0,
      unrecognizedUnitTokens: { oz: 1 },
    });
    expect(String(store[0].packageSize)).toBe('330');
    expect(store[0].packageUnit).toBe('ml');
    expect(store[0].packageBaseUnit).toBe(BaseUnit.ML);
    expect(String(store[0].servingSize)).toBe('60');
    expect(store[0].servingUnit).toBe('g');
    expect(store[0].servingBaseUnit).toBe(BaseUnit.G);
    expect(store[1].packageSize).toBe('1');
    expect(store[1].packageUnit).toBe('oz');
    expect(store[1].packageBaseUnit).toBeNull();
    expect(second.changedRows).toBe(0);
    expect(JSON.stringify(store)).toBe(afterFirst);
  });

  it('dry-run reports changes without writing', async () => {
    const { store, prisma } = makeFakePrisma([
      row('a', { packageSize: '1.5', packageUnit: 'l' }),
    ]);

    const result = await normalizeProductUnits(prisma as never, {
      dryRun: true,
    });

    expect(result.changedRows).toBe(1);
    expect(prisma.packagedProduct.update).not.toHaveBeenCalled();
    expect(store[0].packageSize).toBe('1.5');
  });

  it('reports empty pairs and unrecognized tokens without row data', async () => {
    const { prisma } = makeFakePrisma([
      row('empty'),
      row('unknown', {
        packageSize: '1',
        packageUnit: 'Stone.',
        servingUnit: 'portion',
      }),
    ]);

    const result = await normalizeProductUnits(prisma as never, {
      dryRun: true,
    });

    expect(result.emptyPairs).toBe(2);
    expect(result.unrecognizedUnitTokens).toEqual({
      stone: 1,
      portion: 1,
    });
  });
});

describe('verifyProductUnits', () => {
  it('passes normalized and intentionally absent pairs', async () => {
    const { prisma } = makeFakePrisma([
      row('clean', {
        packageSize: new Prisma.Decimal('330'),
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        servingSize: '1',
        servingUnit: 'bar',
        servingBaseUnit: null,
      }),
    ]);

    const report = await verifyProductUnits(prisma as never);

    expect(distinctViolationCount(report)).toBe(0);
  });

  it('catches each verify violation class', async () => {
    const { prisma } = makeFakePrisma([
      row('missing-base', { packageSize: '10', packageUnit: 'g' }),
      row('unusable-base', {
        packageSize: '1',
        packageUnit: 'oz',
        packageBaseUnit: BaseUnit.G,
      }),
      row('mismatch', {
        packageSize: '1',
        packageUnit: 'l',
        packageBaseUnit: BaseUnit.ML,
      }),
    ]);

    const report = await verifyProductUnits(prisma as never);

    expect(report.usableWithoutBaseUnit).toEqual(['missing-base:package']);
    expect(report.unusableWithBaseUnit).toEqual(['unusable-base:package']);
    expect(report.normalizedMismatch).toEqual(['mismatch:package']);
    expect(distinctViolationCount(report)).toBe(3);
  });

  it('prints references by class, capped at 50 with the remainder count', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const usableWithoutBaseUnit = Array.from(
      { length: 52 },
      (_, index) => `row-${index}:package`,
    );

    printVerifyReport({
      total: 54,
      usableWithoutBaseUnit,
      unusableWithBaseUnit: ['bad-unit:serving'],
      normalizedMismatch: ['mismatch:package'],
    });

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toContain('    row-0:package');
    expect(lines).toContain('    row-49:package');
    expect(lines).not.toContain('    row-50:package');
    expect(lines).toContain('    +2 more');
    expect(lines).toContain('    bad-unit:serving');
    expect(lines).toContain('    mismatch:package');
    log.mockRestore();
  });
});

describe('parseCliArgs', () => {
  it('accepts normalize, dry-run, and verify modes', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'normalize', dryRun: false });
    expect(parseCliArgs(['--dry-run'])).toEqual({
      kind: 'normalize',
      dryRun: true,
    });
    expect(parseCliArgs(['--verify'])).toEqual({ kind: 'verify' });
  });

  it('rejects unknown, duplicate, and conflicting flags', () => {
    expect(() => parseCliArgs(['--verfy'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--verify', '--verify'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--dry-run', '--verify'])).toThrow(
      CliUsageError,
    );
  });
});

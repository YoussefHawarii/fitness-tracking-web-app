import {
  countUnrecognizedUnitTokens,
  formatUnrecognizedUnitTokens,
  importPackagedProducts,
  parsePackagedProductRecords,
} from '../../prisma/import-packaged-products';
import {
  BaseUnit,
  ContainerKey,
  ProductSource,
  VerificationStatus,
} from '@prisma/client';

describe('parsePackagedProductRecords', () => {
  it('parses a valid JSON array', () => {
    const records = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode: '3017620422003',
          name: 'Nutella',
          caloriesPer100g: 539,
          proteinPer100g: 6.3,
          carbsPer100g: 57.5,
          fatPer100g: 30.9,
          brand: 'Ferrero',
          imageUrl: 'https://images.example/nutella.jpg',
        },
      ]),
      'json',
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      barcode: '3017620422003',
      name: 'Nutella',
      caloriesPer100g: 539,
      brand: 'Ferrero',
      nameAr: null,
      imageUrl: 'https://images.example/nutella.jpg',
    });
  });

  it('canonicalizes a 12-digit UPC-A barcode to its 13-digit EAN-13 form', () => {
    const records = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode: '012345678905',
          name: 'Test Product',
          caloriesPer100g: 100,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        },
      ]),
      'json',
    );

    expect(records[0].barcode).toBe('0012345678905');
  });

  it('normalizes package and serving pairs into Base units', () => {
    const [record] = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode: '3017620422003',
          name: 'Normalized Product',
          packageSize: 0.33,
          packageUnit: 'L',
          servingSize: 60000,
          servingUnit: 'mg',
          containerKey: 'box',
          caloriesPer100g: 100,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        },
      ]),
      'json',
    );

    expect(record).toMatchObject({
      packageSize: 330,
      packageUnit: 'ml',
      packageBaseUnit: BaseUnit.ML,
      servingSize: 60,
      servingUnit: 'g',
      servingBaseUnit: BaseUnit.G,
      containerKey: ContainerKey.BOX,
    });
  });

  it('drops unsupported or incomplete imported measurement pairs', () => {
    const [record] = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode: '3017620422003',
          name: 'Incomplete Product',
          packageSize: 12,
          servingSize: 1,
          servingUnit: 'bar',
          caloriesPer100g: 100,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        },
      ]),
      'json',
    );

    expect(record).toMatchObject({
      packageSize: null,
      packageUnit: null,
      packageBaseUnit: null,
      servingSize: null,
      servingUnit: null,
      servingBaseUnit: null,
      unrecognizedUnitTokens: ['bar'],
    });
  });

  it.each([
    ['packageSize', 'not-a-number'],
    ['servingSize', 'NaN'],
  ])('rejects a non-numeric non-empty %s', (field, value) => {
    expect(() =>
      parsePackagedProductRecords(
        JSON.stringify([
          {
            barcode: '3017620422003',
            name: 'Invalid size',
            [field]: value,
            caloriesPer100g: 100,
            proteinPer100g: 1,
            carbsPer100g: 1,
            fatPer100g: 1,
          },
        ]),
        'json',
      ),
    ).toThrow(new RegExp(field));
  });

  it.each(['packageSize', 'servingSize'])('rejects a negative %s', (field) => {
    expect(() =>
      parsePackagedProductRecords(
        JSON.stringify([
          {
            barcode: '3017620422003',
            name: 'Negative size',
            [field]: -1,
            caloriesPer100g: 100,
            proteinPer100g: 1,
            carbsPer100g: 1,
            fatPer100g: 1,
          },
        ]),
        'json',
      ),
    ).toThrow(new RegExp(`${field}.*negative`));
  });

  it('counts unrecognized units while leaving their pairs absent', () => {
    const records = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode: '3017620422003',
          name: 'Unknown units',
          packageSize: 12,
          packageUnit: 'Stone.',
          servingSize: 1,
          servingUnit: 'stone',
          caloriesPer100g: 100,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        },
      ]),
      'json',
    );

    expect(records[0]).toMatchObject({
      packageSize: null,
      packageUnit: null,
      packageBaseUnit: null,
      servingSize: null,
      servingUnit: null,
      servingBaseUnit: null,
      unrecognizedUnitTokens: ['stone', 'stone'],
    });
    expect(countUnrecognizedUnitTokens(records)).toEqual({ stone: 2 });
    expect(formatUnrecognizedUnitTokens({ stone: 2, bar: 1 })).toBe(
      'bar → 1, stone → 2',
    );
  });

  it('parses a valid CSV file', () => {
    const csv = [
      'barcode,name,caloriesPer100g,proteinPer100g,carbsPer100g,fatPer100g,brand',
      '3017620422003,Nutella,539,6.3,57.5,30.9,Ferrero',
    ].join('\n');

    const records = parsePackagedProductRecords(csv, 'csv');

    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('Nutella');
    expect(records[0].brand).toBe('Ferrero');
  });

  it('rejects a record with an invalid barcode', () => {
    expect(() =>
      parsePackagedProductRecords(
        JSON.stringify([
          {
            barcode: 'not-a-barcode',
            name: 'Test',
            caloriesPer100g: 100,
            proteinPer100g: 1,
            carbsPer100g: 1,
            fatPer100g: 1,
          },
        ]),
        'json',
      ),
    ).toThrow(/not a valid/);
  });

  it('rejects a record missing a required numeric field', () => {
    expect(() =>
      parsePackagedProductRecords(
        JSON.stringify([
          {
            barcode: '3017620422003',
            name: 'Test',
            proteinPer100g: 1,
            carbsPer100g: 1,
            fatPer100g: 1,
          },
        ]),
        'json',
      ),
    ).toThrow(/caloriesPer100g/);
  });

  it.each([
    'name',
    'caloriesPer100g',
    'proteinPer100g',
    'carbsPer100g',
    'fatPer100g',
  ])(
    'rejects a record missing required field %s with an actionable error',
    (field) => {
      const record: Record<string, unknown> = {
        barcode: '3017620422003',
        name: 'Test',
        caloriesPer100g: 100,
        proteinPer100g: 1,
        carbsPer100g: 1,
        fatPer100g: 1,
      };
      delete record[field];

      expect(() =>
        parsePackagedProductRecords(JSON.stringify([record]), 'json'),
      ).toThrow(new RegExp(field));
    },
  );

  it('rejects a negative nutrition value', () => {
    expect(() =>
      parsePackagedProductRecords(
        JSON.stringify([
          {
            barcode: '3017620422003',
            name: 'Test',
            caloriesPer100g: -5,
            proteinPer100g: 1,
            carbsPer100g: 1,
            fatPer100g: 1,
          },
        ]),
        'json',
      ),
    ).toThrow(/negative/);
  });

  it('rejects two records sharing the same barcode within one file', () => {
    const record = {
      barcode: '3017620422003',
      name: 'Test',
      caloriesPer100g: 100,
      proteinPer100g: 1,
      carbsPer100g: 1,
      fatPer100g: 1,
    };

    expect(() =>
      parsePackagedProductRecords(JSON.stringify([record, record]), 'json'),
    ).toThrow(/duplicate barcode/);
  });

  it('rejects UPC-A and equivalent EAN-13 spellings as duplicates', () => {
    const base = {
      name: 'Test',
      caloriesPer100g: 100,
      proteinPer100g: 1,
      carbsPer100g: 1,
      fatPer100g: 1,
    };

    expect(() =>
      parsePackagedProductRecords(
        JSON.stringify([
          { ...base, barcode: '012345678905' },
          { ...base, barcode: '0012345678905' },
        ]),
        'json',
      ),
    ).toThrow(/duplicate barcode/);
  });
});

describe('importPackagedProducts', () => {
  it('creates new products tagged ADMIN/EXTERNAL and skips already-known barcodes', async () => {
    const records = parsePackagedProductRecords(
      JSON.stringify([
        {
          barcode: '3017620422003',
          name: 'New Product',
          packageSize: 0.33,
          packageUnit: 'L',
          caloriesPer100g: 100,
          proteinPer100g: 1,
          carbsPer100g: 1,
          fatPer100g: 1,
        },
        {
          barcode: '5000112548167',
          name: 'Already Known',
          caloriesPer100g: 200,
          proteinPer100g: 2,
          carbsPer100g: 2,
          fatPer100g: 2,
        },
      ]),
      'json',
    );

    const prisma = {
      packagedProduct: {
        findUnique: jest.fn((args: { where: { barcode: string } }) =>
          Promise.resolve(
            args.where.barcode === '5000112548167' ? { id: 'existing' } : null,
          ),
        ),
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          void args; // kept for type inference on .mock.calls[n][0] below
          return Promise.resolve({ id: 'new-row' });
        }),
      },
    };

    const result = await importPackagedProducts(records, prisma as never);

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(prisma.packagedProduct.create).toHaveBeenCalledTimes(1);
    const data = prisma.packagedProduct.create.mock.calls[0][0].data;
    expect(data.source).toBe(ProductSource.ADMIN);
    expect(data.verificationStatus).toBe(VerificationStatus.EXTERNAL);
    expect(data.containerKey).toBe(ContainerKey.PACKAGE);
    expect(data.packageSize).toBe(330);
    expect(data.packageUnit).toBe('ml');
    expect(data.packageBaseUnit).toBe(BaseUnit.ML);
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { OpenFoodFactsClient } from '../../src/modules/food/clients/open-food-facts.client';
import { OPEN_FOOD_FACTS_TIMEOUT_MS } from '../../src/modules/food/clients/open-food-facts.client';
import { BaseUnit, ContainerKey } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Open Food Facts' real API is inconsistent about how it reports "no such
// product": confirmed against the live API that a well-formed barcode with
// no match returns a genuine HTTP 404, while a malformed barcode returns
// HTTP 200 with body.status 0. Both must resolve to "not found" (null), not
// "the service is down" — see docs/food-log-input-modes-diagnosis.md.
describe('OpenFoodFactsClient.lookupByBarcode', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(response: {
    ok: boolean;
    status: number;
    body?: unknown;
  }) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body ?? {}),
    });
  }

  function mockRecordedFixture(name: string) {
    const body = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'off', `${name}.json`),
        'utf8',
      ),
    ) as unknown;
    mockFetch({ ok: true, status: 200, body });
  }

  it('returns not found on a genuine HTTP 404', async () => {
    mockFetch({
      ok: false,
      status: 404,
      body: { code: '9999999999993', status: 0 },
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('9999999999993')).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
  });

  it('returns not found on HTTP 200 with body.status 0', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 0 } });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('0000000000000')).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
  });

  it('returns the product on a real match', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: {
          product_name: 'Cheerios',
          nutriments: {
            'energy-kcal_100g': 375,
            proteins_100g: 7.5,
            carbohydrates_100g: 80,
            fat_100g: 6.5,
          },
        },
      },
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).resolves.toEqual({
      outcome: 'FOUND_WITH_NUTRITION',
      barcode: '123456',
      name: 'Cheerios',
      caloriesPer100g: 375,
      proteinPer100g: 7.5,
      carbsPer100g: 80,
      fatPer100g: 6.5,
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
      fiberPer100g: null,
      sugarPer100g: null,
      sodiumPer100g: null,
      imageUrl: null,
      country: null,
    });
  });

  it('extracts brand, image, size, and extended nutrients when Open Food Facts provides them', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: {
          product_name: 'Chipsy Salt & Vinegar',
          product_name_ar: 'شيبسي ملح وخل',
          brands: 'Chipsy,PepsiCo',
          categories: 'Snacks, Salty snacks, Chips and fries',
          countries: 'Egypt',
          image_front_url: 'https://images.example/chipsy.jpg',
          quantity: '150g',
          product_quantity: 150,
          product_quantity_unit: 'g',
          serving_size: '30 g',
          serving_quantity: 30,
          serving_quantity_unit: 'g',
          packagings: [{ shape: 'en:bag' }],
          nutriments: {
            'energy-kcal_100g': 536,
            proteins_100g: 6.5,
            carbohydrates_100g: 53,
            fat_100g: 33,
            fiber_100g: 4.2,
            sugars_100g: 1.1,
            sodium_100g: 0.6,
          },
        },
      },
    });
    const client = new OpenFoodFactsClient();

    const result = await client.lookupByBarcode('6224000234567');

    expect(result).toMatchObject({
      name: 'Chipsy Salt & Vinegar',
      nameAr: 'شيبسي ملح وخل',
      brand: 'Chipsy,PepsiCo',
      category: 'Snacks',
      country: 'Egypt',
      imageUrl: 'https://images.example/chipsy.jpg',
      packageSize: 150,
      packageUnit: 'g',
      packageBaseUnit: BaseUnit.G,
      servingSize: 30,
      servingUnit: 'g',
      servingBaseUnit: BaseUnit.G,
      containerKey: ContainerKey.BAG,
      fiberPer100g: 4.2,
      sugarPer100g: 1.1,
      sodiumPer100g: 0.6,
    });
  });

  it('uses numeric serving fields over free text and maps a volume can', async () => {
    mockRecordedFixture('5449000000996');
    const client = new OpenFoodFactsClient();

    const result = await client.lookupByBarcode('5449000000996');

    expect(result).toMatchObject({
      packageSize: 330,
      packageUnit: 'ml',
      packageBaseUnit: BaseUnit.ML,
      servingSize: 330,
      servingUnit: 'ml',
      servingBaseUnit: BaseUnit.ML,
      containerKey: ContainerKey.CAN,
    });
  });

  it('does not fall back to free-text sizes when structured pairs are absent', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: {
          product_name: 'Text-only sizes',
          quantity: '330 ml',
          serving_size: '1 portion (330 ml)',
          nutriments: { 'energy-kcal_100g': 42 },
        },
      },
    });
    const client = new OpenFoodFactsClient();

    const result = await client.lookupByBarcode('123456');

    expect(result).toMatchObject({
      packageSize: null,
      packageUnit: null,
      packageBaseUnit: null,
      servingSize: null,
      servingUnit: null,
      servingBaseUnit: null,
    });
  });

  it.each([
    [33, 'cl', 330, 'ml', BaseUnit.ML],
    [0.33, 'L', 330, 'ml', BaseUnit.ML],
    [1.5, 'l', 1500, 'ml', BaseUnit.ML],
    [0.06, 'kg', 60, 'g', BaseUnit.G],
    [8, 'fl oz', 236.5882365, 'ml', BaseUnit.ML],
    [12, 'oz', null, null, null],
    [1, 'portion', null, null, null],
  ])(
    'normalizes structured OFF package pair %s %s',
    async (quantity, unit, value, legacyUnit, baseUnit) => {
      mockFetch({
        ok: true,
        status: 200,
        body: {
          status: 1,
          product: {
            product_name: 'Synthetic product',
            product_quantity: quantity,
            product_quantity_unit: unit,
            nutriments: { 'energy-kcal_100g': 42 },
          },
        },
      });
      const client = new OpenFoodFactsClient();

      const result = await client.lookupByBarcode('123456');

      expect(result).toMatchObject({
        packageSize: value,
        packageUnit: legacyUnit,
        packageBaseUnit: baseUnit,
      });
    },
  );

  it('uses structured quantity fields despite noisy free-text quantity', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: {
          product_name: 'Noisy quantity',
          quantity: '500ml مل',
          product_quantity: 500,
          product_quantity_unit: 'ml',
          nutriments: { 'energy-kcal_100g': 42 },
        },
      },
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).resolves.toEqual(
      expect.objectContaining({
        packageSize: 500,
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
      }),
    );
  });

  it('does not catalogue a recorded zero-calorie product', async () => {
    mockRecordedFixture('7613035833289');
    const client = new OpenFoodFactsClient();

    const result = await client.lookupByBarcode('7613035833289');

    expect(result).toEqual({
      outcome: 'FOUND_WITHOUT_NUTRITION',
      identification: {
        barcode: '7613035833289',
        name: 'Eau minérale naturelle gazeuse',
        brand: 'Perrier',
        imageUrl: null,
        packageSize: 6000,
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        containerKey: ContainerKey.BOTTLE,
      },
    });
  });

  it('captures package and serving metadata in different dimensions as-is', async () => {
    mockRecordedFixture('5000112637922');
    const client = new OpenFoodFactsClient();

    const result = await client.lookupByBarcode('5000112637922');

    expect(result).toMatchObject({
      packageSize: 330,
      packageBaseUnit: BaseUnit.ML,
      servingSize: 330,
      servingBaseUnit: BaseUnit.G,
      containerKey: ContainerKey.CAN,
    });
  });

  it.each([
    ['3017620422003', ContainerKey.JAR],
    ['5053990101597', ContainerKey.BOX],
    ['3046920022606', ContainerKey.PACKAGE],
  ])(
    'selects the primary container for fixture %s',
    async (barcode, expected) => {
      mockRecordedFixture(barcode);
      const client = new OpenFoodFactsClient();

      await expect(client.lookupByBarcode(barcode)).resolves.toEqual(
        expect.objectContaining({ containerKey: expected }),
      );
    },
  );

  it('returns identity data when the product exists without usable calories', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: {
          product_name: 'Some Regional Snack',
          brands: 'Regional Foods',
          image_front_url: 'https://images.example/regional-snack.jpg',
          nutriments: {},
        },
      },
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).resolves.toEqual({
      outcome: 'FOUND_WITHOUT_NUTRITION',
      identification: {
        barcode: '123456',
        name: 'Some Regional Snack',
        brand: 'Regional Foods',
        imageUrl: 'https://images.example/regional-snack.jpg',
      },
    });
  });

  it('retains usable portion metadata when the product has no usable calories', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: {
          product_name: 'Portioned product',
          product_quantity: 330,
          product_quantity_unit: 'ml',
          serving_quantity: 30,
          serving_quantity_unit: 'g',
          packagings: [{ shape: 'en:can' }],
          nutriments: {},
        },
      },
    });

    await expect(
      new OpenFoodFactsClient().lookupByBarcode('123456'),
    ).resolves.toMatchObject({
      outcome: 'FOUND_WITHOUT_NUTRITION',
      identification: {
        packageSize: 330,
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        servingSize: 30,
        servingUnit: 'g',
        servingBaseUnit: BaseUnit.G,
        containerKey: ContainerKey.CAN,
      },
    });
  });

  it.each([0, -1, Number.NaN])(
    'never treats %s calories as usable nutrition',
    async (calories) => {
      mockFetch({
        ok: true,
        status: 200,
        body: {
          status: 1,
          product: {
            product_name: 'Unusable calories',
            nutriments: { 'energy-kcal_100g': calories },
          },
        },
      });
      const client = new OpenFoodFactsClient();

      await expect(client.lookupByBarcode('123456')).resolves.toMatchObject({
        outcome: 'FOUND_WITHOUT_NUTRITION',
      });
    },
  );

  it('throws ServiceUnavailableException on a genuine outage (5xx)', async () => {
    mockFetch({ ok: false, status: 503 });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps a network failure to ServiceUnavailableException', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps an unparseable successful response to ServiceUnavailableException', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('invalid JSON')),
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('aborts a hung Open Food Facts request after the configured timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, init) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error('missing abort signal'));
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const client = new OpenFoodFactsClient();

    const lookup = client.lookupByBarcode('123456');
    const assertion = expect(lookup).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(OPEN_FOOD_FACTS_TIMEOUT_MS);

    await assertion;
    jest.useRealTimers();
  });

  it('sends an identifying User-Agent, per OFF integration guidance', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 0 } });
    const client = new OpenFoodFactsClient();

    await client.lookupByBarcode('123456');

    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['User-Agent']).toContain('FitnessTrackingWebApp');
  });
});

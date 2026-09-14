import { ServiceUnavailableException } from '@nestjs/common';
import { OpenFoodFactsClient } from '../../src/modules/food/clients/open-food-facts.client';

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

  it('returns null on a genuine HTTP 404 (well-formed barcode, no product)', async () => {
    mockFetch({
      ok: false,
      status: 404,
      body: { code: '9999999999993', status: 0 },
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('9999999999993')).resolves.toBeNull();
  });

  it('returns null on HTTP 200 with body.status 0 (malformed barcode)', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 0 } });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('0000000000000')).resolves.toBeNull();
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
      barcode: '123456',
      name: 'Cheerios',
      caloriesPer100g: 375,
      proteinPer100g: 7.5,
      carbsPer100g: 80,
      fatPer100g: 6.5,
    });
  });

  it('returns null when the product exists but has no calorie data', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        status: 1,
        product: { product_name: 'Some Regional Snack', nutriments: {} },
      },
    });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).resolves.toBeNull();
  });

  it('throws ServiceUnavailableException on a genuine outage (5xx)', async () => {
    mockFetch({ ok: false, status: 503 });
    const client = new OpenFoodFactsClient();

    await expect(client.lookupByBarcode('123456')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
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

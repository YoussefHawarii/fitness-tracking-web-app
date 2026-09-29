import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let foodServiceModule;
let apiClientModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [foodServiceModule, apiClientModule] = await Promise.all([
    vite.ssrLoadModule('/src/services/foodService.ts'),
    vite.ssrLoadModule('/src/services/apiClient.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

test('getEntryDisplayAmount returns amount when present', () => {
  assert.equal(
    foodServiceModule.getEntryDisplayAmount({ amount: '150' }),
    '150',
  );
});

test('formatEntryAmount renders the exact history text', () => {
  assert.equal(
    foodServiceModule.formatEntryAmount({ amount: '150', amountUnit: 'G' }),
    '150 g',
  );
  // Decimal-like string keeps today's toFixed(0) rounding.
  assert.equal(
    foodServiceModule.formatEntryAmount({ amount: '62.5', amountUnit: 'G' }),
    `${Number('62.5').toFixed(0)} g`,
  );
  assert.equal(
    foodServiceModule.formatEntryAmount({
      amount: '330',
      amountUnit: 'ML',
    }),
    '330 ml',
  );
  assert.equal(
    foodServiceModule.formatEntryAmount({
      amount: '330.5',
      amountUnit: 'ML',
    }),
    '330.5 ml',
  );
});

test('createFoodLog sends the explicit amount representation unchanged', async () => {
  const originalPost = apiClientModule.apiClient.post;
  let captured;
  try {
    apiClientModule.apiClient.post = async (url, input) => {
      captured = { url, input };
      return { data: { id: 'log-1' } };
    };
    await foodServiceModule.createFoodLog({
      sourceType: 'PACKAGED_PRODUCT',
      sourceRef: 'product-1',
      amount: 330,
      amountUnit: 'ML',
      portionKind: 'CUSTOM',
      mealCategory: 'LUNCH',
      loggedAtUtc: '2026-09-28T12:00:00.000Z',
    });
    assert.deepEqual(captured, {
      url: '/food/logs',
      input: {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'product-1',
        amount: 330,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-09-28T12:00:00.000Z',
      },
    });
  } finally {
    apiClientModule.apiClient.post = originalPost;
  }
});

test('updateFoodLog sends the explicit amount and portion representation unchanged', async () => {
  const originalPatch = apiClientModule.apiClient.patch;
  let captured;
  try {
    apiClientModule.apiClient.patch = async (url, input) => {
      captured = { url, input };
      return { data: { id: 'log-1' } };
    };
    await foodServiceModule.updateFoodLog('log-1', {
      amount: 500,
      amountUnit: 'ML',
      portionKind: 'SERVING',
      portionMultiplier: 2,
      mealCategory: 'DINNER',
    });
    assert.deepEqual(captured, {
      url: '/food/logs/log-1',
      input: {
        amount: 500,
        amountUnit: 'ML',
        portionKind: 'SERVING',
        portionMultiplier: 2,
        mealCategory: 'DINNER',
      },
    });
  } finally {
    apiClientModule.apiClient.patch = originalPatch;
  }
});

test('getPackagedProduct requests current resolution by product id', async () => {
  const originalGet = apiClientModule.apiClient.get;
  let requestedUrl;
  try {
    apiClientModule.apiClient.get = async (url) => {
      requestedUrl = url;
      return { data: { id: 'product/1', resolution: { outcome: 'LOGGABLE' } } };
    };
    const product = await foodServiceModule.getPackagedProduct('product/1');
    assert.equal(requestedUrl, '/food/products/product%2F1');
    assert.equal(product.id, 'product/1');
  } finally {
    apiClientModule.apiClient.get = originalGet;
  }
});

test('getEditPrefill returns the exact edit-input string', () => {
  assert.equal(foodServiceModule.getEditPrefill({ amount: '150' }), '150');
  // Decimal-like string is passed through unrounded.
  assert.equal(foodServiceModule.getEditPrefill({ amount: '62.5' }), '62.5');
});

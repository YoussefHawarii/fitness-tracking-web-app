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
    foodServiceModule.getEntryDisplayAmount({ amount: '150', grams: '150' }),
    '150',
  );
  assert.equal(
    foodServiceModule.getEntryDisplayAmount({ amount: '150', grams: '100' }),
    '150',
  );
});

test('getEntryDisplayAmount falls back to grams when amount is null/absent', () => {
  // A grams-only response (pre-dual-write row) still renders/pre-fills.
  assert.equal(
    foodServiceModule.getEntryDisplayAmount({ amount: null, grams: '100' }),
    '100',
  );
  assert.equal(
    foodServiceModule.getEntryDisplayAmount({ grams: '100' }),
    '100',
  );
});

test('formatEntryAmount renders the exact history text', () => {
  // Amount present wins over grams.
  assert.equal(
    foodServiceModule.formatEntryAmount({ amount: '150', grams: '100' }),
    '150 g',
  );
  // Amount null falls back to grams.
  assert.equal(
    foodServiceModule.formatEntryAmount({ amount: null, grams: '100' }),
    '100 g',
  );
  // Amount absent (property missing) falls back to grams.
  assert.equal(foodServiceModule.formatEntryAmount({ grams: '100' }), '100 g');
  // Decimal-like string keeps today's toFixed(0) rounding.
  assert.equal(
    foodServiceModule.formatEntryAmount({ amount: '62.5', grams: '100' }),
    `${Number('62.5').toFixed(0)} g`,
  );
  assert.equal(
    foodServiceModule.formatEntryAmount({ grams: '62.5' }),
    `${Number('62.5').toFixed(0)} g`,
  );
  // Neither present renders "0 g", matching current behaviour.
  assert.equal(
    foodServiceModule.formatEntryAmount({ amount: null, grams: null }),
    '0 g',
  );
  assert.equal(
    foodServiceModule.formatEntryAmount({
      amount: '330',
      grams: null,
      amountUnit: 'ML',
    }),
    '330 ml',
  );
  assert.equal(
    foodServiceModule.formatEntryAmount({
      amount: '330.5',
      grams: null,
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

test('getEditPrefill returns the exact edit-input string', () => {
  // Amount present wins over grams.
  assert.equal(
    foodServiceModule.getEditPrefill({ amount: '150', grams: '100' }),
    '150',
  );
  // Amount null falls back to grams.
  assert.equal(
    foodServiceModule.getEditPrefill({ amount: null, grams: '100' }),
    '100',
  );
  // Amount absent (property missing) falls back to grams.
  assert.equal(foodServiceModule.getEditPrefill({ grams: '100' }), '100');
  // Decimal-like string is passed through unrounded.
  assert.equal(
    foodServiceModule.getEditPrefill({ amount: '62.5', grams: '100' }),
    '62.5',
  );
  assert.equal(foodServiceModule.getEditPrefill({ grams: '62.5' }), '62.5');
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let foodLogModule;
let addProductModule;
let foodServiceModule;
let apiClientModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
    ssr: { noExternal: ['@zxing/browser', '@zxing/library'] },
  });
  [foodLogModule, addProductModule, foodServiceModule, apiClientModule] =
    await Promise.all([
      vite.ssrLoadModule('/src/pages/FoodLog.tsx'),
      vite.ssrLoadModule('/src/features/add-product/AddProductForm.tsx'),
      vite.ssrLoadModule('/src/services/foodService.ts'),
      vite.ssrLoadModule('/src/services/apiClient.ts'),
    ]);
});

after(async () => {
  await vite.close();
});

test('rich product preview renders provided metadata, every macro, and status-driven verification', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.PackagedProductPreview, {
      product: {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'product-1',
        name: 'Chipsy Salt & Vinegar',
        nameAr: 'شيبسي ملح وخل',
        brand: 'Chipsy',
        imageUrl: 'https://images.example/chipsy.jpg',
        packageSize: 150,
        packageUnit: 'g',
        caloriesPer100g: 536,
        proteinPer100g: 6.5,
        carbsPer100g: 53,
        fatPer100g: 33,
        verificationStatus: 'VERIFIED',
      },
    }),
  );

  assert.match(html, /Chipsy Salt &amp; Vinegar/);
  assert.match(html, /شيبسي ملح وخل/);
  assert.match(html, /https:\/\/images\.example\/chipsy\.jpg/);
  assert.match(html, /150 g/);
  assert.match(html, /536 kcal/);
  assert.match(html, /6\.5g protein/);
  assert.match(html, /53g carbs/);
  assert.match(html, /33g fat/);
  assert.match(html, />Verified</);
});

test('preview exposes missing macros as unavailable, shows a unitless size, and never calls EXTERNAL verified', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.PackagedProductPreview, {
      product: {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'product-2',
        name: 'Imported product',
        caloriesPer100g: 100,
        proteinPer100g: null,
        carbsPer100g: null,
        fatPer100g: null,
        packageSize: 2,
        packageUnit: null,
        verificationStatus: 'EXTERNAL',
      },
    }),
  );

  assert.match(html, />2</);
  assert.match(html, /Protein: not available/);
  assert.match(html, /Carbs: not available/);
  assert.match(html, /Fat: not available/);
  assert.doesNotMatch(html, />Verified</);
});

test('not-found actions retain add-product, manual-search, and rescan choices', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.BarcodeNotFoundActions, {
      onAdd: () => undefined,
      onSearch: () => undefined,
      onRescan: () => undefined,
    }),
  );

  assert.match(html, /Add this product/);
  assert.match(html, /Search manually instead/);
  assert.match(html, /Scan again/);
});

test('Not scalable panel renders identity and safe fallbacks without logging controls', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.NotLoggableProductPanel, {
      resolution: {
        outcome: 'NOT_LOGGABLE',
        display: {
          name: 'Conflicting Cola',
          brand: 'Example Drinks',
          imageUrl: 'https://images.example/conflicting-cola.jpg',
        },
        subjectKind: 'PACKAGED_PRODUCT',
        primaryReason: 'DIMENSION_BASIS_CONFLICT',
      },
      onAdd: () => undefined,
      onSearch: () => undefined,
      onRescan: () => undefined,
    }),
  );

  assert.match(html, /Conflicting Cola/);
  assert.match(html, /Example Drinks/);
  assert.match(html, /https:\/\/images\.example\/conflicting-cola\.jpg/);
  assert.match(html, /portion unit conflicts with its nutrition basis/);
  assert.match(html, /can&#x27;t be logged safely/);
  assert.match(html, /Search manually instead/);
  assert.match(html, /Scan again/);
  assert.doesNotMatch(html, /Add this product/);
  assert.doesNotMatch(html, /Save entry/);
  assert.doesNotMatch(html, />Grams</);
});

test('invalid barcodes stay distinct from confirmed not-found responses', async () => {
  const originalGet = apiClientModule.apiClient.get;
  try {
    apiClientModule.apiClient.get = async () => {
      throw { isAxiosError: true, response: { status: 400 } };
    };
    await assert.rejects(
      () => foodServiceModule.lookupBarcode('3017620422004'),
      foodServiceModule.InvalidBarcodeError,
    );

    apiClientModule.apiClient.get = async () => {
      throw { isAxiosError: true, response: { status: 404 } };
    };
    assert.equal(await foodServiceModule.lookupBarcode('9999999999993'), null);
  } finally {
    apiClientModule.apiClient.get = originalGet;
  }
});

test('nutrition extraction candidates become editable form values without creating a product', () => {
  const values = addProductModule.nutritionCandidateToFormValues({
    caloriesPer100g: 0,
    proteinPer100g: 5,
    carbsPer100g: 12,
    fatPer100g: 3,
    servingSize: 30,
    servingUnit: 'g',
  });

  assert.deepEqual(values, {
    caloriesPer100g: '0',
    proteinPer100g: '5',
    carbsPer100g: '12',
    fatPer100g: '3',
    servingSize: '30',
    servingUnit: 'g',
  });
  assert.equal(
    addProductModule.validateNonNegative('-1', 'Protein'),
    'Protein must be 0 or more.',
  );

  const formHtml = renderToStaticMarkup(
    React.createElement(addProductModule.AddProductForm, {
      barcode: '3017620422003',
      onCreated: () => undefined,
    }),
  );
  assert.match(formHtml, /Scan nutrition label \(optional\)/);
  assert.match(formHtml, /Product name \(required\)/);
  assert.match(formHtml, /Calories \/ 100g \(required\)/);
  assert.match(formHtml, /Country/);
  assert.match(formHtml, /Create product/);
});

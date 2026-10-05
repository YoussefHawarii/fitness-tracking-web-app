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
let editPortionOptionsModule;
let addProductGuardModule;
let extractionFormValuesModule;
let scannerLifecycleModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
    ssr: { noExternal: ['@zxing/browser', '@zxing/library'] },
  });
  [
    foodLogModule,
    addProductModule,
    foodServiceModule,
    apiClientModule,
    editPortionOptionsModule,
    addProductGuardModule,
    extractionFormValuesModule,
    scannerLifecycleModule,
  ] = await Promise.all([
    vite.ssrLoadModule('/src/pages/FoodLog.tsx'),
    vite.ssrLoadModule('/src/features/add-product/AddProductForm.tsx'),
    vite.ssrLoadModule('/src/services/foodService.ts'),
    vite.ssrLoadModule('/src/services/apiClient.ts'),
    vite.ssrLoadModule('/src/features/portion-selector/editPortionOptions.ts'),
    vite.ssrLoadModule('/src/features/add-product/submissionGuard.ts'),
    vite.ssrLoadModule('/src/features/add-product/extractionFormValues.ts'),
    vite.ssrLoadModule('/src/features/barcode-scanner/scannerLifecycle.ts'),
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
        packageBaseUnit: 'G',
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
        packageBaseUnit: null,
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

test('identified-without-nutrition panel is distinct and offers both fallbacks', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.NotLoggableProductPanel, {
      resolution: {
        outcome: 'NOT_LOGGABLE',
        display: {
          name: 'Known Regional Snack',
          brand: 'Regional Foods',
          imageUrl: 'https://images.example/known-regional-snack.jpg',
        },
        subjectKind: 'IDENTIFIED_NOT_CATALOGUED',
        primaryReason: 'NUTRITION_MISSING',
      },
      onAdd: () => undefined,
      onSearch: () => undefined,
      onRescan: () => undefined,
    }),
  );

  assert.match(html, /Known Regional Snack/);
  assert.match(html, /Regional Foods/);
  assert.match(html, /https:\/\/images\.example\/known-regional-snack\.jpg/);
  assert.match(html, /identified, but no usable nutrition data is available/);
  assert.match(html, /Add this product/);
  assert.match(html, /Search manually instead/);
  assert.match(html, /Scan again/);
  assert.doesNotMatch(html, /Save entry/);
});

function loggableResolution(basis) {
  const volume = basis === 'PER_100_ML';
  return {
    outcome: 'LOGGABLE',
    portionDimension: volume ? 'VOLUME' : 'MASS',
    effectiveNutritionBasis: {
      basis,
      origin: 'INFERRED',
      source: 'OPEN_FOOD_FACTS',
      ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
    },
    package: { size: volume ? 330 : 125, baseUnit: volume ? 'ML' : 'G' },
    serving: null,
    containerKey: volume ? 'CAN' : 'PACKAGE',
  };
}

test('pending barcode amount fields render the effective VOLUME basis and ml input', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.PendingAmountFields, {
      item: {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'drink-1',
        name: 'Test drink',
        caloriesPer100g: 42,
        resolution: loggableResolution('PER_100_ML'),
      },
      amount: '330',
      onAmountChange: () => undefined,
    }),
  );

  assert.match(html, /42 kcal \/ 100 ml/);
  assert.match(html, /Amount \(ml\)/);
  assert.match(html, /step="0\.1"/);
});

test('pending barcode amount fields render the effective MASS basis and g input', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.PendingAmountFields, {
      item: {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'food-1',
        name: 'Test food',
        caloriesPer100g: 250,
        resolution: loggableResolution('PER_100_G'),
      },
      amount: '125',
      onAmountChange: () => undefined,
    }),
  );

  assert.match(html, /250 kcal \/ 100 g/);
  assert.match(html, /Amount \(g\)/);
});

test('a barcode response without resolution keeps the mass presentation', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.PendingAmountFields, {
      item: {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'legacy-1',
        name: 'Legacy product',
        caloriesPer100g: 100,
      },
      amount: '',
      onAmountChange: () => undefined,
    }),
  );

  assert.match(html, /100 kcal\/100g/);
  assert.match(html, /Amount \(g\)/);
});

test('the edit amount field keeps ML amounts editable with their unit', () => {
  const html = renderToStaticMarkup(
    React.createElement(foodLogModule.EditAmountField, {
      entry: {
        id: 'log-1',
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'product-1',
        name: 'Test drink',
        amount: '330',
        amountUnit: 'ML',
        caloriesComputed: '138.6',
        mealCategory: 'LUNCH',
        loggedAtUtc: '2026-09-28T12:00:00.000Z',
      },
      value: '330',
      onChange: () => undefined,
    }),
  );

  assert.match(html, /Amount \(ml\)/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('packaged-product edit offers create options and falls back to CUSTOM after serving metadata changes', () => {
  const currentResolution = {
    ...loggableResolution('PER_100_ML'),
    package: { size: 600, baseUnit: 'ML' },
    serving: { size: 300, baseUnit: 'ML' },
    containerKey: 'BOTTLE',
  };
  const model = editPortionOptionsModule.buildEditPortionOptions(
    {
      id: 'log-1',
      sourceType: 'PACKAGED_PRODUCT',
      sourceRef: 'product-1',
      name: 'Test drink',
      amount: '250',
      amountUnit: 'ML',
      portionKind: 'SERVING',
      portionMultiplier: '1',
      caloriesComputed: '105',
      mealCategory: 'LUNCH',
      loggedAtUtc: '2026-09-28T12:00:00.000Z',
    },
    currentResolution,
  );

  assert.deepEqual(
    model.options.map(({ id }) => id),
    ['SERVING_HALF', 'SERVING_ONE', 'SERVING_TWO', 'PACKAGE_ONE', 'CUSTOM'],
  );
  assert.deepEqual(model.defaultSelection, {
    optionId: 'CUSTOM',
    choice: { portionKind: 'CUSTOM', amount: 250 },
  });
});

test('history amount rendering includes ml and g units', () => {
  const volumeHtml = renderToStaticMarkup(
    React.createElement(foodLogModule.HistoryAmount, {
      entry: { amount: '330', amountUnit: 'ML' },
    }),
  );
  const massHtml = renderToStaticMarkup(
    React.createElement(foodLogModule.HistoryAmount, {
      entry: { amount: '150', amountUnit: 'G' },
    }),
  );

  assert.equal(volumeHtml, '330 ml');
  assert.equal(massHtml, '150 g');
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

test('missing product basis errors preserve the typed reason and server message', async () => {
  const originalPost = apiClientModule.apiClient.post;
  try {
    apiClientModule.apiClient.post = async () => {
      throw {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            reason: 'DECLARED_NUTRITION_BASIS_REQUIRED',
            message: 'Choose whether nutrition is per 100 g or per 100 ml.',
          },
        },
      };
    };

    await assert.rejects(
      () =>
        foodServiceModule.createPackagedProduct({
          barcode: '3017620422003',
          name: 'Missing basis product',
          declaredNutritionBasis: 'PER_100_G',
          caloriesPer100g: 100,
          proteinPer100g: 2,
          carbsPer100g: 20,
          fatPer100g: 1,
        }),
      (error) => {
        assert.ok(error instanceof foodServiceModule.ProductSubmissionError);
        assert.equal(error.reason, 'DECLARED_NUTRITION_BASIS_REQUIRED');
        assert.equal(
          error.message,
          'Choose whether nutrition is per 100 g or per 100 ml.',
        );
        return true;
      },
    );
  } finally {
    apiClientModule.apiClient.post = originalPost;
  }
});

const EMPTY_LABEL_FORM = {
  values: {
    caloriesPer100g: '',
    proteinPer100g: '',
    carbsPer100g: '',
    fatPer100g: '',
  },
  basis: '',
  basisSelectedByUser: false,
};

function scanResult(overrides = {}) {
  return {
    outcome: 'ok',
    basisSuggestion: 'PER_100_G',
    warnings: [],
    readings: [
      {
        field: 'caloriesPer100g',
        value: 0,
        unit: 'kcal',
        status: 'read',
        warnings: [],
      },
      {
        field: 'proteinPer100g',
        value: 21,
        unit: 'g',
        status: 'read',
        warnings: [],
      },
      {
        field: 'carbsPer100g',
        value: 40,
        unit: 'g',
        status: 'read',
        warnings: [],
      },
      { field: 'fatPer100g', status: 'not-found', warnings: [] },
    ],
    ...overrides,
  };
}

test('Add Product offers optional label scanning without loading any OCR up front', () => {
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
  assert.match(formHtml, />Scan nutrition label<\/button>/);
  assert.doesNotMatch(formHtml, /type="file"/);
  assert.match(formHtml, /Product name \(required\)/);
  assert.match(formHtml, /Nutrition basis \(required\)/);
  assert.match(formHtml, /<select[^>]*required=""/);
  assert.match(formHtml, /Per 100 g/);
  assert.match(formHtml, /Per 100 ml/);
  assert.match(formHtml, /Calories \/ selected basis \(required\)/);
  assert.match(formHtml, /Country/);
  assert.match(formHtml, /Create product/);
});

test('applying a per-100 label scan fills empty fields and suggests the basis without submitting', () => {
  let requests = 0;
  const update = extractionFormValuesModule.labelScanToFormUpdate(
    scanResult(),
    EMPTY_LABEL_FORM,
  );

  assert.deepEqual(update, {
    values: { caloriesPer100g: '0', proteinPer100g: '21', carbsPer100g: '40' },
    basis: 'PER_100_G',
  });
  assert.equal(requests, 0);
});

test('applying a label scan never overwrites a value already in the form', () => {
  const update = extractionFormValuesModule.labelScanToFormUpdate(
    scanResult(),
    {
      ...EMPTY_LABEL_FORM,
      values: { ...EMPTY_LABEL_FORM.values, proteinPer100g: '20' },
    },
  );

  assert.equal(update.values.proteinPer100g, undefined);
  assert.equal(update.values.carbsPer100g, '40');
});

test('a label scan never replaces a basis the user selected, even mid-scan', () => {
  // The user picks Per 100 ml while recognition is still running; the
  // form state at Apply time carries that choice.
  const update = extractionFormValuesModule.labelScanToFormUpdate(
    scanResult(),
    {
      ...EMPTY_LABEL_FORM,
      basis: 'PER_100_ML',
      basisSelectedByUser: true,
    },
  );
  assert.equal(update.basis, undefined);

  let submittedBasis;
  const submission = addProductGuardModule.withDeclaredNutritionBasis(
    'PER_100_ML',
    (basis) => {
      submittedBasis = basis;
      return basis;
    },
  );
  assert.deepEqual(submission, { allowed: true, value: 'PER_100_ML' });
  assert.equal(submittedBasis, 'PER_100_ML');
});

test('a label scan with no per-100 column fills nothing and leaves submission blocked', () => {
  const update = extractionFormValuesModule.labelScanToFormUpdate(
    scanResult({ outcome: 'no-per-100-column', basisSuggestion: undefined }),
    EMPTY_LABEL_FORM,
  );
  assert.deepEqual(update, { values: {} });

  let requests = 0;
  const submission = addProductGuardModule.withDeclaredNutritionBasis(
    '',
    () => {
      requests += 1;
    },
  );
  assert.deepEqual(submission, {
    allowed: false,
    error: addProductGuardModule.DECLARED_BASIS_REQUIRED_MESSAGE,
  });
  assert.equal(requests, 0);
});

test('identified product identity pre-fills Add Product while basis remains user-supplied', () => {
  const html = renderToStaticMarkup(
    React.createElement(addProductModule.AddProductForm, {
      barcode: '3017620422003',
      initialName: 'Known Regional Snack',
      initialBrand: 'Regional Foods',
      onCreated: () => undefined,
    }),
  );

  assert.match(html, /Barcode: 3017620422003/);
  assert.match(html, /value="Known Regional Snack"/);
  assert.match(html, /value="Regional Foods"/);
  assert.match(html, /<option value="" selected="">Choose a basis<\/option>/);
});

test('Add Product blocks a missing basis without starting a request', () => {
  let requests = 0;
  const result = addProductGuardModule.withDeclaredNutritionBasis('', () => {
    requests += 1;
    return Promise.resolve();
  });

  assert.deepEqual(result, {
    allowed: false,
    error: addProductGuardModule.DECLARED_BASIS_REQUIRED_MESSAGE,
  });
  assert.equal(requests, 0);
});

test('barcode scanning is paused for identified results and while Add Product is open', () => {
  assert.equal(
    scannerLifecycleModule.shouldMountBarcodeScanner(
      'identified-no-nutrition',
      false,
    ),
    false,
  );
  assert.equal(
    scannerLifecycleModule.shouldMountBarcodeScanner('idle', true),
    false,
  );
  assert.equal(
    scannerLifecycleModule.shouldMountBarcodeScanner('idle', false),
    true,
  );
});

const ADD_PRODUCT_FIELDS = {
  name: '  Lentil Soup  ',
  nameAr: '',
  brand: 'Regional Foods',
  category: '',
  caloriesPer100g: '60',
  proteinPer100g: '3.5',
  carbsPer100g: '9',
  fatPer100g: '1.2',
  fiberPer100g: '',
  sugarPer100g: '0.8',
  sodiumMgPer100: '',
  servingSize: '250',
  servingUnit: 'ml',
  packageSize: '',
  packageUnit: '',
  country: '',
};

test('Add Product submits sodium typed in mg as grams per 100', () => {
  const input = addProductGuardModule.buildPackagedProductInput(
    '6221007012345',
    { ...ADD_PRODUCT_FIELDS, sodiumMgPer100: '400' },
    'PER_100_ML',
  );
  assert.equal(input.sodiumPer100g, 0.4);
  assert.equal(
    addProductGuardModule.buildPackagedProductInput(
      '6221007012345',
      { ...ADD_PRODUCT_FIELDS, sodiumMgPer100: '123.4' },
      'PER_100_ML',
    ).sodiumPer100g,
    0.1234,
  );
  assert.equal(
    addProductGuardModule.buildPackagedProductInput(
      '6221007012345',
      { ...ADD_PRODUCT_FIELDS, sodiumMgPer100: '0.0004' },
      'PER_100_ML',
    ).sodiumPer100g,
    0.0000004,
  );
});

test('Add Product submits a typed 0 mg sodium as 0 and omits a blank one', () => {
  const zero = addProductGuardModule.buildPackagedProductInput(
    '6221007012345',
    { ...ADD_PRODUCT_FIELDS, sodiumMgPer100: '0' },
    'PER_100_ML',
  );
  assert.equal(zero.sodiumPer100g, 0);

  const blank = addProductGuardModule.buildPackagedProductInput(
    '6221007012345',
    ADD_PRODUCT_FIELDS,
    'PER_100_ML',
  );
  assert.equal('sodiumPer100g' in blank, false);
});

test('Add Product payload keeps every other field as typed and omits blanks', () => {
  const input = addProductGuardModule.buildPackagedProductInput(
    '6221007012345',
    { ...ADD_PRODUCT_FIELDS, sodiumMgPer100: '400' },
    'PER_100_ML',
  );
  assert.deepEqual(input, {
    barcode: '6221007012345',
    name: 'Lentil Soup',
    brand: 'Regional Foods',
    caloriesPer100g: 60,
    proteinPer100g: 3.5,
    carbsPer100g: 9,
    fatPer100g: 1.2,
    sugarPer100g: 0.8,
    sodiumPer100g: 0.4,
    servingSize: 250,
    servingUnit: 'ml',
    declaredNutritionBasis: 'PER_100_ML',
  });
});

test('Add Product labels sodium in mg for the selected basis', () => {
  const html = renderToStaticMarkup(
    React.createElement(addProductModule.AddProductForm, {
      barcode: '6221007012345',
      onCreated: () => undefined,
    }),
  );
  assert.match(html, /Sodium \(mg\) \/ selected basis/);
  assert.equal(
    addProductModule.validateNonNegative('-5', 'Sodium'),
    'Sodium must be 0 or more.',
  );
});

test('a label scan whose basis differs from the form basis applies nothing', () => {
  for (const basisSelectedByUser of [true, false]) {
    const update = extractionFormValuesModule.labelScanToFormUpdate(
      scanResult({ basisSuggestion: 'PER_100_G' }),
      { ...EMPTY_LABEL_FORM, basis: 'PER_100_ML', basisSelectedByUser },
    );
    assert.deepEqual(update, {
      values: {},
      basisConflict: { label: 'PER_100_G', form: 'PER_100_ML' },
    });
  }

  const sameBasis = extractionFormValuesModule.labelScanToFormUpdate(
    scanResult({ basisSuggestion: 'PER_100_ML' }),
    { ...EMPTY_LABEL_FORM, basis: 'PER_100_ML', basisSelectedByUser: true },
  );
  assert.equal(sameBasis.values.proteinPer100g, '21');
  assert.equal(sameBasis.basisConflict, undefined);
});

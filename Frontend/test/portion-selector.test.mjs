import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let optionsModule;
let selectorModule;
let calculationsModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [optionsModule, selectorModule, calculationsModule] = await Promise.all([
    vite.ssrLoadModule('/src/features/portion-selector/portionOptions.ts'),
    vite.ssrLoadModule('/src/features/portion-selector/PortionSelector.tsx'),
    vite.ssrLoadModule('/src/features/portion-selector/portionCalculations.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

function resolution({
  packageMeasurement = null,
  serving = null,
  containerKey = 'PACKAGE',
  baseUnit = 'G',
} = {}) {
  return {
    outcome: 'LOGGABLE',
    portionDimension: baseUnit === 'ML' ? 'VOLUME' : 'MASS',
    effectiveNutritionBasis: {
      basis: baseUnit === 'ML' ? 'PER_100_ML' : 'PER_100_G',
      origin: 'INFERRED',
      source: 'OPEN_FOOD_FACTS',
      ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
    },
    package: packageMeasurement,
    serving,
    containerKey,
  };
}

function optionIds(model) {
  return model.options.map(({ id }) => id);
}

test('Scenario A defaults to PACKAGE x 1 with the complete quick-option set', () => {
  const model = optionsModule.buildPortionOptions(
    resolution({
      packageMeasurement: { size: 330, baseUnit: 'ML' },
      serving: { size: 330, baseUnit: 'ML' },
      containerKey: 'CAN',
      baseUnit: 'ML',
    }),
  );

  assert.deepEqual(optionIds(model), [
    'SERVING_HALF',
    'SERVING_ONE',
    'SERVING_TWO',
    'PACKAGE_ONE',
    'CUSTOM',
  ]);
  assert.deepEqual(model.defaultSelection, {
    optionId: 'PACKAGE_ONE',
    choice: {
      portionKind: 'PACKAGE',
      portionMultiplier: 1,
      amount: 330,
    },
  });
});

test('Scenario B defaults to one serving and does not add a 1.5 shortcut', () => {
  const model = optionsModule.buildPortionOptions(
    resolution({
      packageMeasurement: { size: 500, baseUnit: 'G' },
      serving: { size: 125, baseUnit: 'G' },
    }),
  );

  assert.deepEqual(optionIds(model), [
    'SERVING_HALF',
    'SERVING_ONE',
    'SERVING_TWO',
    'PACKAGE_ONE',
    'CUSTOM',
  ]);
  assert.equal(model.defaultSelection.optionId, 'SERVING_ONE');
  assert.equal(
    model.options.some(({ label }) => label.includes('1.5 serving')),
    false,
  );
});

test('Scenario C offers serving shortcuts and custom, defaulting to one serving', () => {
  const model = optionsModule.buildPortionOptions(
    resolution({ serving: { size: 250, baseUnit: 'ML' }, baseUnit: 'ML' }),
  );

  assert.deepEqual(optionIds(model), [
    'SERVING_HALF',
    'SERVING_ONE',
    'SERVING_TWO',
    'CUSTOM',
  ]);
  assert.equal(model.defaultSelection.optionId, 'SERVING_ONE');
});

test('Scenario D offers package and custom with nothing preselected', () => {
  const model = optionsModule.buildPortionOptions(
    resolution({ packageMeasurement: { size: 400, baseUnit: 'G' } }),
  );

  assert.deepEqual(optionIds(model), ['PACKAGE_ONE', 'CUSTOM']);
  assert.equal(model.defaultSelection, null);
});

test('a discarded serving reaches Scenario D through the serialized resolution shape', () => {
  const model = optionsModule.buildPortionOptions(
    resolution({
      packageMeasurement: { size: 500, baseUnit: 'ML' },
      serving: null,
      baseUnit: 'ML',
    }),
  );

  assert.deepEqual(optionIds(model), ['PACKAGE_ONE', 'CUSTOM']);
  assert.equal(model.defaultSelection, null);
});

test('Scenario E offers only an empty custom selection', () => {
  const model = optionsModule.buildPortionOptions(resolution());

  assert.deepEqual(optionIds(model), ['CUSTOM']);
  assert.deepEqual(model.defaultSelection, {
    optionId: 'CUSTOM',
    choice: { portionKind: 'CUSTOM', amount: null },
  });
});

test('structured labels include resolved amounts and large values use L and kg', () => {
  const volumeModel = optionsModule.buildPortionOptions(
    resolution({
      packageMeasurement: { size: 1500, baseUnit: 'ML' },
      serving: { size: 250, baseUnit: 'ML' },
      baseUnit: 'ML',
    }),
  );
  assert.deepEqual(
    volumeModel.options.map(({ label }) => label),
    [
      '0.5 serving (125 ml)',
      '1 serving (250 ml)',
      '2 servings (500 ml)',
      'Whole package (1.5 L)',
      'Custom amount',
    ],
  );

  const massModel = optionsModule.buildPortionOptions(
    resolution({ packageMeasurement: { size: 2000, baseUnit: 'G' } }),
  );
  assert.equal(massModel.options[0].label, 'Whole package (2 kg)');
  for (const option of [...volumeModel.options, ...massModel.options]) {
    if (option.choice.portionKind !== 'CUSTOM') {
      assert.match(option.label, /\(.+ (?:g|kg|ml|L)\)$/);
    }
  }
});

test('container keys select only the package noun and unknown keys fall back safely', () => {
  const expected = {
    PACKAGE: 'Whole package (330 ml)',
    CAN: '1 can (330 ml)',
    BOTTLE: '1 bottle (330 ml)',
    JAR: '1 jar (330 ml)',
    BOX: '1 box (330 ml)',
    BAG: '1 bag (330 ml)',
  };

  for (const [containerKey, label] of Object.entries(expected)) {
    const model = optionsModule.buildPortionOptions(
      resolution({
        packageMeasurement: { size: 330, baseUnit: 'ML' },
        serving: { size: 330, baseUnit: 'ML' },
        baseUnit: 'ML',
        containerKey,
      }),
    );
    assert.equal(
      model.options.find(({ id }) => id === 'PACKAGE_ONE').label,
      label,
    );
    assert.deepEqual(optionIds(model), [
      'SERVING_HALF',
      'SERVING_ONE',
      'SERVING_TWO',
      'PACKAGE_ONE',
      'CUSTOM',
    ]);
    assert.equal(model.defaultSelection.optionId, 'PACKAGE_ONE');
  }

  const fallback = optionsModule.buildPortionOptions(
    resolution({
      packageMeasurement: { size: 330, baseUnit: 'ML' },
      baseUnit: 'ML',
      containerKey: 'en:raw-provider-tag',
    }),
  );
  assert.equal(fallback.options[0].label, 'Whole package (330 ml)');
  assert.doesNotMatch(fallback.options[0].label, /raw-provider-tag/);
});

test('every structured choice stays within backend consistency tolerance', () => {
  const cases = [
    {
      resolution: resolution({
        packageMeasurement: { size: 500, baseUnit: 'G' },
        serving: { size: 125.5, baseUnit: 'G' },
      }),
      packageSize: 500,
      servingSize: 125.5,
    },
    {
      resolution: resolution({
        packageMeasurement: { size: 1500, baseUnit: 'ML' },
        serving: { size: 250, baseUnit: 'ML' },
        baseUnit: 'ML',
      }),
      packageSize: 1500,
      servingSize: 250,
    },
  ];

  for (const fixture of cases) {
    const model = optionsModule.buildPortionOptions(fixture.resolution);
    for (const { choice } of model.options) {
      if (choice.portionKind === 'CUSTOM') {
        assert.equal(choice.portionMultiplier, undefined);
        continue;
      }
      const sourceSize =
        choice.portionKind === 'PACKAGE'
          ? fixture.packageSize
          : fixture.servingSize;
      assert.ok(
        Math.abs(choice.amount - choice.portionMultiplier * sourceSize) <= 0.05,
      );
    }
  }

  const half = optionsModule
    .buildPortionOptions(cases[0].resolution)
    .options.find(({ id }) => id === 'SERVING_HALF');
  assert.equal(half.choice.amount, 62.8);
  assert.equal(half.label, '0.5 serving (62.8 g)');
});

const MASS_PRODUCT_FIXTURE = JSON.parse(`{
  "id":"mass-1","barcode":"1234567890128","name":"Cereal","nameAr":null,
  "brand":"Example","category":"Breakfast","servingSize":30,"servingUnit":"g",
  "servingBaseUnit":"G","packageSize":300,"packageUnit":"g","packageBaseUnit":"G",
  "containerKey":"BOX","caloriesPer100g":380,"proteinPer100g":10,
  "carbsPer100g":72,"fatPer100g":4,"fiberPer100g":8,"sugarPer100g":12,
  "sodiumPer100g":0.2,"imageUrl":null,"country":"Egypt","source":"OPEN_FOOD_FACTS",
  "verificationStatus":"EXTERNAL","resolution":{"outcome":"LOGGABLE",
  "portionDimension":"MASS","effectiveNutritionBasis":{"basis":"PER_100_G",
  "origin":"INFERRED","source":"OPEN_FOOD_FACTS",
  "ruleId":"OPEN_FOOD_FACTS_PORTION_DIMENSION"},
  "package":{"size":300,"baseUnit":"G"},
  "serving":{"size":30,"baseUnit":"G"},"containerKey":"BOX"}}
`);

const VOLUME_PRODUCT_FIXTURE = JSON.parse(`{
  "id":"volume-1","barcode":"1234567890135","name":"Sparkling water","nameAr":null,
  "brand":"Example","category":"Drinks","servingSize":330,"servingUnit":"ml",
  "servingBaseUnit":"ML","packageSize":330,"packageUnit":"ml","packageBaseUnit":"ML",
  "containerKey":"CAN","caloriesPer100g":0,"proteinPer100g":null,
  "carbsPer100g":null,"fatPer100g":null,"fiberPer100g":null,"sugarPer100g":null,
  "sodiumPer100g":null,"imageUrl":null,"country":null,"source":"OPEN_FOOD_FACTS",
  "verificationStatus":"EXTERNAL","resolution":{"outcome":"LOGGABLE",
  "portionDimension":"VOLUME","effectiveNutritionBasis":{"basis":"PER_100_ML",
  "origin":"INFERRED","source":"OPEN_FOOD_FACTS",
  "ruleId":"OPEN_FOOD_FACTS_PORTION_DIMENSION"},
  "package":{"size":330,"baseUnit":"ML"},"serving":{"size":330,"baseUnit":"ML"},
  "containerKey":"CAN"}}
`);

test('serialized MASS and VOLUME barcode responses drive their real defaults', () => {
  const mass = optionsModule.buildPortionOptions(
    MASS_PRODUCT_FIXTURE.resolution,
  );
  const volume = optionsModule.buildPortionOptions(
    VOLUME_PRODUCT_FIXTURE.resolution,
  );

  assert.equal(mass.defaultSelection.optionId, 'SERVING_ONE');
  assert.equal(mass.defaultSelection.choice.amount, 30);
  assert.equal(volume.defaultSelection.optionId, 'PACKAGE_ONE');
  assert.equal(volume.defaultSelection.choice.portionKind, 'PACKAGE');
});

test('normalized package and serving values produce Scenario A on the backend response shape', () => {
  assert.deepEqual(VOLUME_PRODUCT_FIXTURE.resolution.package, {
    size: 330,
    baseUnit: 'ML',
  });
  assert.deepEqual(VOLUME_PRODUCT_FIXTURE.resolution.serving, {
    size: 330,
    baseUnit: 'ML',
  });
  const model = optionsModule.buildPortionOptions(
    VOLUME_PRODUCT_FIXTURE.resolution,
  );
  assert.equal(model.defaultSelection.optionId, 'PACKAGE_ONE');
});

test('a stored choice matching an offered option remains structured', () => {
  const matching = optionsModule.buildPortionOptions(
    VOLUME_PRODUCT_FIXTURE.resolution,
    {
      portionKind: 'SERVING',
      portionMultiplier: 2,
      amount: 660,
      amountUnit: 'ML',
    },
  );

  assert.deepEqual(matching.defaultSelection, {
    optionId: 'SERVING_TWO',
    choice: {
      portionKind: 'SERVING',
      portionMultiplier: 2,
      amount: 660,
    },
  });
});

test('valid stored multipliers outside the quick options remain structured', () => {
  const productResolution = resolution({
    packageMeasurement: { size: 500, baseUnit: 'ML' },
    serving: { size: 250, baseUnit: 'ML' },
    baseUnit: 'ML',
  });
  const serving = optionsModule.buildPortionOptions(productResolution, {
    portionKind: 'SERVING',
    portionMultiplier: 1.5,
    amount: 375,
    amountUnit: 'ML',
  });
  const packages = optionsModule.buildPortionOptions(productResolution, {
    portionKind: 'PACKAGE',
    portionMultiplier: 3,
    amount: 1500,
    amountUnit: 'ML',
  });

  assert.deepEqual(serving.defaultSelection, {
    optionId: 'STORED',
    choice: {
      portionKind: 'SERVING',
      portionMultiplier: 1.5,
      amount: 375,
    },
  });
  assert.equal(
    serving.options.find(({ id }) => id === 'STORED').label,
    '1.5 servings (375 ml)',
  );
  assert.deepEqual(packages.defaultSelection.choice, {
    portionKind: 'PACKAGE',
    portionMultiplier: 3,
    amount: 1500,
  });
  assert.equal(
    packages.options.find(({ id }) => id === 'STORED').label,
    '3 packages (1.5 L)',
  );
});

test('changed measurements and unit mismatches present stored amounts as custom', () => {
  const currentResolution = resolution({
    packageMeasurement: { size: 600, baseUnit: 'ML' },
    serving: { size: 300, baseUnit: 'ML' },
    baseUnit: 'ML',
  });
  const changedServing = optionsModule.buildPortionOptions(currentResolution, {
    portionKind: 'SERVING',
    portionMultiplier: 1,
    amount: 250,
    amountUnit: 'ML',
  });
  const unitMismatch = optionsModule.buildPortionOptions(currentResolution, {
    portionKind: 'SERVING',
    portionMultiplier: 1,
    amount: 300,
    amountUnit: 'G',
  });

  assert.deepEqual(changedServing.defaultSelection, {
    optionId: 'CUSTOM',
    choice: { portionKind: 'CUSTOM', amount: 250 },
  });
  assert.deepEqual(unitMismatch.defaultSelection, {
    optionId: 'CUSTOM',
    choice: { portionKind: 'CUSTOM', amount: 300 },
  });
});

test('stored CUSTOM and null kinds preserve their authoritative amount as custom', () => {
  for (const portionKind of ['CUSTOM', null]) {
    const model = optionsModule.buildPortionOptions(
      VOLUME_PRODUCT_FIXTURE.resolution,
      {
        portionKind,
        amount: 275,
        amountUnit: 'ML',
      },
    );
    assert.deepEqual(model.defaultSelection, {
      optionId: 'CUSTOM',
      choice: { portionKind: 'CUSTOM', amount: 275 },
    });
  }
});

test('create payloads preserve structured choices, block no selection, and omit custom multipliers', () => {
  const scenarioA = optionsModule.buildPortionOptions(
    VOLUME_PRODUCT_FIXTURE.resolution,
  );
  assert.deepEqual(
    calculationsModule.buildPortionCreatePayload(
      VOLUME_PRODUCT_FIXTURE.resolution,
      scenarioA.defaultSelection.choice,
      '',
    ),
    {
      amount: 330,
      amountUnit: 'ML',
      portionKind: 'PACKAGE',
      portionMultiplier: 1,
    },
  );

  const scenarioDResolution = resolution({
    packageMeasurement: { size: 500, baseUnit: 'ML' },
    baseUnit: 'ML',
  });
  assert.equal(
    calculationsModule.buildPortionCreatePayload(scenarioDResolution, null, ''),
    null,
  );
  assert.deepEqual(
    calculationsModule.buildPortionCreatePayload(
      scenarioDResolution,
      { portionKind: 'CUSTOM', amount: null },
      '125.5',
    ),
    { amount: 125.5, amountUnit: 'ML', portionKind: 'CUSTOM' },
  );
});

test('portion preview scales each available nutrient without early rounding', () => {
  assert.deepEqual(
    calculationsModule.calculatePortionNutrition(
      {
        caloriesPer100g: 80,
        proteinPer100g: 4,
        carbsPer100g: null,
        fatPer100g: 2.5,
      },
      250,
    ),
    {
      calories: 200,
      protein: 10,
      carbs: null,
      fat: 6.25,
    },
  );
});

test('selector static markup marks the scenario default as selected', () => {
  const model = optionsModule.buildPortionOptions(
    MASS_PRODUCT_FIXTURE.resolution,
  );
  const html = renderToStaticMarkup(
    React.createElement(selectorModule.PortionSelector, {
      options: model.options,
      selectedOptionId: model.defaultSelection.optionId,
      customAmount: '',
      baseUnit: 'G',
      onSelectionChange: () => undefined,
      onCustomAmountChange: () => undefined,
    }),
  );

  assert.match(html, /checked="" value="SERVING_ONE"/);
  assert.match(html, /1 serving \(30 g\)/);
  assert.doesNotMatch(html, /Amount \(g\)/);
});

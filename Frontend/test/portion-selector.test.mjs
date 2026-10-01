import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let optionsModule;
let selectorModule;
let calculationsModule;
let plausibilityModule;
let saveDecisionsModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [
    optionsModule,
    selectorModule,
    calculationsModule,
    plausibilityModule,
    saveDecisionsModule,
  ] = await Promise.all([
    vite.ssrLoadModule('/src/features/portion-selector/portionOptions.ts'),
    vite.ssrLoadModule('/src/features/portion-selector/PortionSelector.tsx'),
    vite.ssrLoadModule('/src/features/portion-selector/portionCalculations.ts'),
    vite.ssrLoadModule('/src/features/portion-selector/plausibility.ts'),
    vite.ssrLoadModule('/src/features/portion-selector/saveDecisions.ts'),
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
  "brand":"Example","category":"Breakfast","servingSize":30,
  "servingBaseUnit":"G","packageSize":300,"packageBaseUnit":"G",
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
  "brand":"Example","category":"Drinks","servingSize":330,
  "servingBaseUnit":"ML","packageSize":330,"packageBaseUnit":"ML",
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

test('package plausibility uses a strict three-package threshold', () => {
  const productResolution = resolution({
    packageMeasurement: { size: 330, baseUnit: 'ML' },
    baseUnit: 'ML',
  });
  const expected = new Map([
    [330, false],
    [660, false],
    [990, false],
    [1000, true],
    [3300, true],
  ]);

  for (const [amount, advise] of expected) {
    assert.equal(
      plausibilityModule.assessPlausibility({
        amount,
        amountUnit: 'ML',
        resolution: productResolution,
        entryCalories: 0,
        dailyCalorieTarget: null,
      }).advise,
      advise,
    );
  }
});

test('calorie plausibility is strict and requires a valid target', () => {
  assert.deepEqual(
    plausibilityModule.assessPlausibility({
      amount: 500,
      amountUnit: 'G',
      resolution: null,
      entryCalories: 2000,
      dailyCalorieTarget: 2000,
    }),
    { advise: false },
  );
  assert.equal(
    plausibilityModule.assessPlausibility({
      amount: 500,
      amountUnit: 'G',
      resolution: null,
      entryCalories: 2000.1,
      dailyCalorieTarget: 2000,
    }).advise,
    true,
  );

  for (const dailyCalorieTarget of [null, 0, -500, Number.NaN]) {
    assert.deepEqual(
      plausibilityModule.assessPlausibility({
        amount: 500,
        amountUnit: 'G',
        resolution: null,
        entryCalories: 5000,
        dailyCalorieTarget,
      }),
      { advise: false },
    );
  }
});

test('a package with the other base unit falls through to the calorie rule', () => {
  assert.equal(
    plausibilityModule.assessPlausibility({
      amount: 10,
      amountUnit: 'G',
      resolution: resolution({
        packageMeasurement: { size: 330, baseUnit: 'ML' },
        baseUnit: 'ML',
      }),
      entryCalories: 500.1,
      dailyCalorieTarget: 500,
    }).advise,
    true,
  );
});

test('non-finite and non-positive amounts never advise', () => {
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      plausibilityModule.assessPlausibility({
        amount,
        amountUnit: 'ML',
        resolution: resolution({
          packageMeasurement: { size: 330, baseUnit: 'ML' },
          baseUnit: 'ML',
        }),
        entryCalories: 5000,
        dailyCalorieTarget: 500,
      }),
      { advise: false },
    );
  }
});

test('serving metadata never acts as a plausibility trigger', () => {
  assert.deepEqual(
    plausibilityModule.assessPlausibility({
      amount: 1000,
      amountUnit: 'G',
      resolution: resolution({
        serving: { size: 100, baseUnit: 'G' },
      }),
      entryCalories: 1500,
      dailyCalorieTarget: null,
    }),
    { advise: false },
  );
});

test('package comparison leads the single message and calories add context', () => {
  const result = plausibilityModule.assessPlausibility({
    amount: 1000,
    amountUnit: 'ML',
    resolution: resolution({
      packageMeasurement: { size: 330, baseUnit: 'ML' },
      baseUnit: 'ML',
    }),
    entryCalories: 2500,
    dailyCalorieTarget: 2000,
  });

  assert.equal(result.advise, true);
  assert.match(result.message, /package size.*1 L.*330 ml/i);
  assert.match(result.message, /2500 kcal.*2000 kcal daily target/i);
  assert.ok(result.message.indexOf('package') < result.message.indexOf('kcal'));
});

test('a discarded serving still leaves the package rule in control', () => {
  const productResolution = resolution({
    packageMeasurement: { size: 330, baseUnit: 'ML' },
    serving: null,
    baseUnit: 'ML',
  });

  assert.equal(
    plausibilityModule.assessPlausibility({
      amount: 1000,
      amountUnit: 'ML',
      resolution: productResolution,
      entryCalories: 100,
      dailyCalorieTarget: null,
    }).advise,
    true,
  );
  assert.deepEqual(
    plausibilityModule.assessPlausibility({
      amount: 990,
      amountUnit: 'ML',
      resolution: productResolution,
      entryCalories: 2500,
      dailyCalorieTarget: 2000,
    }),
    { advise: false },
  );
});

test('create save decision preserves the payload on OK and skips save on Cancel', async () => {
  const submittedPayload = {
    sourceType: 'PACKAGED_PRODUCT',
    sourceRef: 'product-1',
    amount: 1000,
    amountUnit: 'ML',
    portionKind: 'CUSTOM',
    mealCategory: 'LUNCH',
    loggedAtUtc: '2026-09-28T12:00:00.000Z',
  };
  const productResolution = resolution({
    packageMeasurement: { size: 330, baseUnit: 'ML' },
    baseUnit: 'ML',
  });
  const savedPayloads = [];
  let confirmations = 0;
  const saved = await saveDecisionsModule.saveCreateWithPlausibility({
    pendingItem: { caloriesPer100g: 250 },
    submittedPayload,
    resolution: productResolution,
    dailyCalorieTarget: 2000,
    confirm: () => {
      confirmations += 1;
      return true;
    },
    save: (payload) => {
      savedPayloads.push(payload);
      return 'created';
    },
  });

  assert.equal(confirmations, 1);
  assert.equal(savedPayloads.length, 1);
  assert.strictEqual(savedPayloads[0], submittedPayload);
  assert.equal('confirmed' in savedPayloads[0], false);
  assert.deepEqual(saved, {
    saved: true,
    payload: submittedPayload,
    value: 'created',
  });

  let canceledSaves = 0;
  const canceled = await saveDecisionsModule.saveCreateWithPlausibility({
    pendingItem: { caloriesPer100g: 250 },
    submittedPayload,
    resolution: productResolution,
    dailyCalorieTarget: 2000,
    confirm: () => false,
    save: () => {
      canceledSaves += 1;
    },
  });
  assert.deepEqual(canceled, { saved: false });
  assert.equal(canceledSaves, 0);
});

test('a missing target does not confirm or block create saving', async () => {
  let confirmations = 0;
  let saves = 0;
  const result = await saveDecisionsModule.saveCreateWithPlausibility({
    pendingItem: { caloriesPer100g: 1000 },
    submittedPayload: {
      sourceType: 'LOCAL',
      sourceRef: 'local-1',
      amount: 500,
      amountUnit: 'G',
      mealCategory: 'SNACKS',
      loggedAtUtc: '2026-09-28T12:00:00.000Z',
    },
    resolution: null,
    dailyCalorieTarget: null,
    confirm: () => {
      confirmations += 1;
      return false;
    },
    save: () => {
      saves += 1;
    },
  });

  assert.equal(result.saved, true);
  assert.equal(confirmations, 0);
  assert.equal(saves, 1);
});

test('meal-only edit saves only its category without confirming', async () => {
  const submittedPayload = { mealCategory: 'DINNER' };
  const savedPayloads = [];
  const result = await saveDecisionsModule.saveEditWithPlausibility({
    entry: {
      amount: '330',
      amountUnit: 'ML',
      caloriesComputed: '150',
    },
    product: { caloriesPer100g: 500 },
    submittedPayload,
    resolution: resolution({
      packageMeasurement: { size: 330, baseUnit: 'ML' },
      baseUnit: 'ML',
    }),
    dailyCalorieTarget: 100,
    confirm: () => {
      throw new Error('Meal-only edits must not confirm.');
    },
    save: (payload) => {
      savedPayloads.push(payload);
      return 'updated';
    },
  });

  assert.strictEqual(savedPayloads[0], submittedPayload);
  assert.deepEqual(savedPayloads[0], { mealCategory: 'DINNER' });
  assert.deepEqual(result, {
    saved: true,
    payload: submittedPayload,
    value: 'updated',
  });
});

test('edit save decision uses the same package threshold as create', async () => {
  const productResolution = resolution({
    packageMeasurement: { size: 330, baseUnit: 'ML' },
    baseUnit: 'ML',
  });
  const entry = {
    amount: '330',
    amountUnit: 'ML',
    caloriesComputed: '100',
  };
  const product = { caloriesPer100g: 10 };

  for (const [amount, shouldSave] of [
    [990, true],
    [1000, false],
  ]) {
    let confirmations = 0;
    let saves = 0;
    const result = await saveDecisionsModule.saveEditWithPlausibility({
      entry,
      product,
      submittedPayload: {
        amount,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
        mealCategory: 'LUNCH',
      },
      resolution: productResolution,
      dailyCalorieTarget: null,
      confirm: () => {
        confirmations += 1;
        return false;
      },
      save: () => {
        saves += 1;
      },
    });

    assert.equal(result.saved, shouldSave);
    assert.equal(confirmations, shouldSave ? 0 : 1);
    assert.equal(saves, shouldSave ? 1 : 0);
  }

  const acceptedPayload = {
    amount: 1000,
    amountUnit: 'ML',
    portionKind: 'CUSTOM',
    mealCategory: 'LUNCH',
  };
  const acceptedPayloads = [];
  const accepted = await saveDecisionsModule.saveEditWithPlausibility({
    entry,
    product,
    submittedPayload: acceptedPayload,
    resolution: productResolution,
    dailyCalorieTarget: null,
    confirm: () => true,
    save: (payload) => {
      acceptedPayloads.push(payload);
      return 'updated';
    },
  });
  assert.strictEqual(acceptedPayloads[0], acceptedPayload);
  assert.equal('confirmed' in acceptedPayloads[0], false);
  assert.deepEqual(accepted, {
    saved: true,
    payload: acceptedPayload,
    value: 'updated',
  });
});

test('edit save decision uses the same strict calorie threshold as create', async () => {
  const entry = {
    amount: '100',
    amountUnit: 'G',
    caloriesComputed: '1000',
  };

  for (const [amount, shouldSave] of [
    [200, true],
    [200.1, false],
  ]) {
    let confirmations = 0;
    let saves = 0;
    const result = await saveDecisionsModule.saveEditWithPlausibility({
      entry,
      product: null,
      submittedPayload: {
        amount,
        amountUnit: 'G',
        portionKind: 'CUSTOM',
        mealCategory: 'DINNER',
      },
      resolution: null,
      dailyCalorieTarget: 2000,
      confirm: () => {
        confirmations += 1;
        return false;
      },
      save: () => {
        saves += 1;
      },
    });

    assert.equal(result.saved, shouldSave);
    assert.equal(confirmations, shouldSave ? 0 : 1);
    assert.equal(saves, shouldSave ? 1 : 0);
  }
});

test('edit calorie estimate falls back to stored values when current product is unusable', async () => {
  const entry = {
    amount: '100',
    amountUnit: 'G',
    caloriesComputed: '100',
  };
  const submittedPayload = {
    amount: 200,
    amountUnit: 'G',
    portionKind: 'CUSTOM',
    mealCategory: 'LUNCH',
  };
  const highCalorieProduct = { caloriesPer100g: 1000 };
  const cases = [
    null,
    resolution({
      packageMeasurement: { size: 330, baseUnit: 'ML' },
      baseUnit: 'ML',
    }),
  ];

  for (const currentResolution of cases) {
    let confirmations = 0;
    let saves = 0;
    const result = await saveDecisionsModule.saveEditWithPlausibility({
      entry,
      product: highCalorieProduct,
      submittedPayload,
      resolution: currentResolution,
      dailyCalorieTarget: 500,
      confirm: () => {
        confirmations += 1;
        return false;
      },
      save: () => {
        saves += 1;
      },
    });

    assert.equal(result.saved, true);
    assert.equal(confirmations, 0);
    assert.equal(saves, 1);
  }
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

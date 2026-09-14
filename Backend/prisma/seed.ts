// Seeds the curated bilingual CanonicalFood catalog — a first pass of common
// staples plus Egyptian-diet items, per
// docs/food-log-input-modes-diagnosis.md §3.4 item 1/5. Idempotent (upserts
// on the unique nameEn), safe to re-run. Nutrient values are standard
// per-100g reference figures (USDA-typical); refine per-item as real usage
// surfaces gaps — this is a starting catalog, not a finished one.
//
// Run with: npm run db:seed  (wraps `prisma db seed`, per this project's
// db-push-only convention — no migrations/ directory).
import { PrismaClient } from '@prisma/client';
import type { SeedFood } from './seed-food.type';
import { EGYPTIAN_FOOD_CATALOG } from './egyptian-food-catalog';

const prisma = new PrismaClient();

const HAND_BUILT_FOODS: SeedFood[] = [
  {
    // "chicken breast"/"فراخ" is deliberately an alias of BOTH the raw and
    // cooked variants below, not just this one — raw vs. cooked is a ~35%
    // calorie difference (120 vs 165/100g), a genuine choice the user needs
    // to make, not noise to collapse. An unqualified query must surface both
    // as candidates rather than silently picking one (see
    // docs/food-log-input-modes-diagnosis.md §3.4 item 3); only the
    // qualified aliases ("raw chicken breast", "grilled chicken breast")
    // resolve to a single item on their own.
    nameEn: 'Chicken breast, raw',
    nameAr: 'صدر فراخ نيء',
    aliasesEn: ['chicken breast', 'chicken', 'raw chicken breast'],
    aliasesAr: ['فراخ', 'دجاج', 'صدر دجاج', 'فراخ نيئة'],
    caloriesPer100g: 120,
    proteinPer100g: 22.5,
    carbsPer100g: 0,
    fatPer100g: 2.6,
  },
  {
    nameEn: 'Chicken breast, cooked',
    nameAr: 'صدر فراخ مشوي',
    aliasesEn: [
      'grilled chicken breast',
      'cooked chicken breast',
      'grilled chicken',
      'chicken breast',
      'chicken',
    ],
    aliasesAr: ['فراخ مشوية', 'صدر دجاج مشوي', 'فراخ مسلوقة', 'فراخ', 'دجاج'],
    caloriesPer100g: 165,
    proteinPer100g: 31,
    carbsPer100g: 0,
    fatPer100g: 3.6,
  },
  {
    // "rice"/"رز" is shared with the raw variant below for the same reason —
    // raw vs. cooked rice is a ~2.8x calorie difference per 100g (measured
    // dry vs. after absorbing water), so a bare "rice" query must show both.
    nameEn: 'Rice, white, cooked',
    nameAr: 'أرز مطبوخ',
    aliasesEn: ['rice', 'cooked rice', 'white rice'],
    aliasesAr: ['رز', 'أرز أبيض', 'رز مطبوخ'],
    caloriesPer100g: 130,
    proteinPer100g: 2.7,
    carbsPer100g: 28,
    fatPer100g: 0.3,
  },
  // "Rice, white, raw" now comes from egyptian-food-catalog.ts (Grains
  // section) — authoritative National Nutrition Institute figures superseded
  // this hand-estimated entry; removed here to avoid a duplicate nameEn.
  {
    // "beef"/"meat"/"لحمة" shared with the cooked variant below, same reason.
    // Estimated figure — the Egyptian NNI dataset (egyptian-food-catalog.csv)
    // only has specific cuts (liver, kofta, tongue, etc.), no generic "beef"
    // entry to supersede this with.
    nameEn: 'Beef, lean, raw',
    nameAr: 'لحم بقري نيء',
    aliasesEn: ['beef', 'red meat', 'raw beef', 'meat'],
    aliasesAr: ['لحمة', 'لحم أحمر', 'لحمة بقري', 'لحم بقر'],
    caloriesPer100g: 186,
    proteinPer100g: 19.6,
    carbsPer100g: 0,
    fatPer100g: 11.9,
  },
  {
    nameEn: 'Beef, lean, cooked',
    nameAr: 'لحم بقري مشوي',
    aliasesEn: [
      'grilled beef',
      'cooked beef',
      'grilled meat',
      'beef',
      'red meat',
      'meat',
    ],
    aliasesAr: ['لحمة مشوية', 'لحم مشوي', 'لحمة', 'لحم أحمر', 'لحم بقر'],
    caloriesPer100g: 217,
    proteinPer100g: 26,
    carbsPer100g: 0,
    fatPer100g: 12,
  },
  {
    // Estimated figure — the Egyptian NNI dataset has egg white (46 kcal)
    // and egg yolk (343 kcal) as separate rows, but no combined "whole egg".
    nameEn: 'Eggs, whole, raw',
    nameAr: 'بيض',
    aliasesEn: ['egg', 'eggs', 'whole egg'],
    aliasesAr: ['بيضة', 'بيض كامل'],
    caloriesPer100g: 149,
    proteinPer100g: 12.6,
    carbsPer100g: 0.3,
    fatPer100g: 10.8,
  },
  {
    nameEn: 'Baladi bread',
    nameAr: 'عيش بلدي',
    aliasesEn: ['aish baladi', 'egyptian bread', 'whole wheat bread', 'bread'],
    aliasesAr: ['خبز بلدي', 'عيش', 'خبز'],
    caloriesPer100g: 254,
    proteinPer100g: 8.8,
    carbsPer100g: 52.5,
    fatPer100g: 1,
  },
  {
    nameEn: 'Ful medames, cooked',
    nameAr: 'فول مدمس',
    aliasesEn: ['ful medames', 'fava beans', 'foul'],
    aliasesAr: ['فول', 'فول مدمّس'],
    caloriesPer100g: 98,
    proteinPer100g: 5.6,
    carbsPer100g: 17.2,
    fatPer100g: 0.7,
  },
  {
    nameEn: 'Lentils, cooked',
    nameAr: 'عدس مطبوخ',
    aliasesEn: ['lentils', 'cooked lentils'],
    aliasesAr: ['عدس'],
    caloriesPer100g: 151,
    proteinPer100g: 5.8,
    carbsPer100g: 19.3,
    fatPer100g: 5.6,
  },
  {
    nameEn: 'Olive oil',
    nameAr: 'زيت زيتون',
    aliasesEn: ['olive oil'],
    aliasesAr: ['زيت الزيتون'],
    caloriesPer100g: 884,
    proteinPer100g: 0,
    carbsPer100g: 0,
    fatPer100g: 100,
  },
  {
    // Estimated figure — the Egyptian NNI dataset's closest rows ("White
    // cheese, half cream", "Sandwich, white cheese") are different products,
    // not a match for plain white cheese.
    nameEn: 'White cheese',
    nameAr: 'جبنة بيضاء',
    aliasesEn: ['white cheese', 'feta cheese', 'gebna beida'],
    aliasesAr: ['جبنة', 'جبن أبيض', 'جبنه بيضاء'],
    caloriesPer100g: 256,
    proteinPer100g: 16.3,
    carbsPer100g: 3.2,
    fatPer100g: 19.8,
  },
  {
    nameEn: 'Yogurt, plain',
    nameAr: 'زبادي',
    aliasesEn: ['yogurt', 'plain yogurt', 'zabadi'],
    aliasesAr: ['لبن زبادي', 'زبادى'],
    caloriesPer100g: 64,
    proteinPer100g: 3.4,
    carbsPer100g: 5.5,
    fatPer100g: 3.2,
  },
  {
    nameEn: 'Tomato, raw',
    nameAr: 'طماطم',
    aliasesEn: ['tomato', 'tomatoes'],
    aliasesAr: ['طماطم طازة', 'أوطة'],
    caloriesPer100g: 20,
    proteinPer100g: 1.1,
    carbsPer100g: 3.1,
    fatPer100g: 0.3,
  },
  {
    nameEn: 'Cucumber, raw',
    nameAr: 'خيار',
    aliasesEn: ['cucumber'],
    aliasesAr: [],
    caloriesPer100g: 16,
    proteinPer100g: 0.7,
    carbsPer100g: 3.1,
    fatPer100g: 0.1,
  },
  {
    // "potato"/"بطاطس" is shared across all three potato preparations below
    // (boiled/fries/pan-fried) — same reasoning as the chicken/beef/rice
    // pairs above: boiled (73 kcal) vs. fries (281 kcal) is nearly 4x
    // difference, so a bare query must surface all of them rather than
    // silently picking one. Added after real usage (user testing manual
    // search) showed only the boiled variant was findable at all.
    nameEn: 'Potato, boiled',
    nameAr: 'بطاطس مسلوقة',
    aliasesEn: ['potato', 'boiled potato', 'potatoes'],
    aliasesAr: ['بطاطا', 'بطاطس'],
    caloriesPer100g: 73,
    proteinPer100g: 1.6,
    carbsPer100g: 16.4,
    fatPer100g: 0.1,
  },
  {
    // Estimated figure, cross-checked against a live USDA lookup (289 kcal)
    // when this entry was first added — the Egyptian NNI dataset has no
    // plain potato entry at all (raw, boiled, or fried).
    nameEn: 'Potato, French fries',
    nameAr: 'بطاطس بوري',
    aliasesEn: ['french fries', 'fries', 'potato fries', 'potato', 'potatoes'],
    aliasesAr: ['بوري', 'بوريه', 'بطاطس', 'بطاطا'],
    caloriesPer100g: 281,
    proteinPer100g: 4.1,
    carbsPer100g: 33.4,
    fatPer100g: 14.5,
  },
  {
    nameEn: 'Potato, pan-fried',
    nameAr: 'بطاطس محمرة',
    aliasesEn: [
      'fried potato',
      'pan-fried potato',
      'roasted potato',
      'potato',
      'potatoes',
    ],
    aliasesAr: ['محمرة', 'بطاطس', 'بطاطا'],
    caloriesPer100g: 197,
    proteinPer100g: 1.9,
    carbsPer100g: 18,
    fatPer100g: 13,
  },
  {
    // Estimated figure — the Egyptian NNI dataset has no banana entry at all.
    nameEn: 'Banana',
    nameAr: 'موز',
    aliasesEn: ['banana', 'bananas'],
    aliasesAr: ['موزة'],
    caloriesPer100g: 95,
    proteinPer100g: 1.3,
    carbsPer100g: 21.7,
    fatPer100g: 0.3,
  },
  {
    nameEn: 'Apple',
    nameAr: 'تفاح',
    aliasesEn: ['apple', 'apples'],
    aliasesAr: ['تفاحة'],
    caloriesPer100g: 57,
    proteinPer100g: 0.4,
    carbsPer100g: 13.5,
    fatPer100g: 0.2,
  },
];

const FOODS: SeedFood[] = [...HAND_BUILT_FOODS, ...EGYPTIAN_FOOD_CATALOG];

async function main() {
  for (const food of FOODS) {
    await prisma.canonicalFood.upsert({
      where: { nameEn: food.nameEn },
      update: {
        nameAr: food.nameAr,
        aliasesEn: food.aliasesEn,
        aliasesAr: food.aliasesAr,
        caloriesPer100g: food.caloriesPer100g,
        proteinPer100g: food.proteinPer100g,
        carbsPer100g: food.carbsPer100g,
        fatPer100g: food.fatPer100g,
      },
      create: food,
    });
  }
  console.log(`Seeded ${FOODS.length} canonical foods.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

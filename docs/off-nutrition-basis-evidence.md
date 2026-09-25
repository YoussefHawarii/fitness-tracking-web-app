# Evidence: what Open Food Facts actually means by its `_100g` nutriment fields

Research note produced during the portion-model grilling session. It exists to
decide one question: **may the nutrition denominator for an Open Food Facts
product be inferred, and if so on what evidence?** It records evidence, not
decisions. No integration code was changed to produce it.

## 1. Fields this application currently consumes

`OpenFoodFactsClient.lookupByBarcode` reads exactly these
(`src/modules/food/clients/open-food-facts.client.ts`):

- `status`, `product`
- `product_name`, `product_name_ar`, `brands`, `categories`, `countries`
- `image_front_url`, `image_url`
- `quantity` (free text) → parsed to `packageSize`/`packageUnit`
- `serving_size` (free text) → parsed to `servingSize`/`servingUnit`
- `nutriments`: `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`,
  `fat_100g`, `fiber_100g`, `sugars_100g`, `sodium_100g`

Not consumed, though available: `product_quantity`, `product_quantity_unit`,
`serving_quantity`, `serving_quantity_unit`, `nutrition_data_per`,
`nutrition_data_prepared_per`, `packagings[]`, and every `*_serving` nutriment.

`parseSize` only accepts a leading `<number><unit>`, so
`serving_size: "1 portion (330 ml)"` parses to **null** even though OFF
separately reports `serving_quantity: 330`, `serving_quantity_unit: "ml"`.

## 2. Existing test fixtures

`test/food/open-food-facts-client.spec.ts` is the only place with raw OFF
response shapes. Every fixture is mass-based (`quantity: "150g"`,
`serving_size: "30 g"`). **There is no volume-based fixture anywhere in the
test suite**, so no existing test can detect a per-100-ml regression.

## 3. What `nutrition_data_per` is

OFF's own API cheat-sheet documents only two values: `100g` and `serving`.
Observed values in live data: `100g`, `serving`, and absent. It is a
contributor-set flag describing which basis the *contributor entered values
under*, not a derived property of the product.

Critically, when `nutrition_data_per` is `serving`, the `_100g` fields are
**computed by OFF** from the per-serving values and `serving_quantity` — they
were not transcribed from a per-100 column on the label at all. Observed in
5/100 olive oils and 11/100 biscuits.

## 4. Is "per 100 ml for volume products" guaranteed, documented, or merely observed?

**Merely observed, and more weakly than first claimed.**

- Not guaranteed: nothing in the API contract ties the `_100g` fields to the
  product's own unit.
- Not documented: the cheat-sheet describes `nutrition_data_per` as `100g` or
  `serving` and says nothing about liquids.
- Observed, with a caveat below: across 12 products fetched from the
  **single-product endpoint this app actually calls**, `nutrition_data_per`
  was either absent (8) or the literal `"100g"` (4) — including for a 1 L
  Coca-Cola, a 1.25 L water and a 330 ml Coke Zero. `"100ml"` never appeared.

### Measurement caveat that invalidates part of this investigation

OFF's **search** API returns different values for the same field depending on
which other fields are requested in the projection:

- Requesting `nutriments` alongside quantity fields silently drops
  `product_quantity_unit` (three separate runs reported "no package unit" for
  ~99% of rows; the single-product endpoint returns `"ml"` for the same
  barcodes).
- Runs that requested `nutriments` reported `nutrition_data_per: "100ml"` for
  68/100 olive oils and 39/100 milks. Runs over the same categories that
  requested the quantity fields instead reported **zero** `"100ml"` and mostly
  absent.

Two queries differing only in requested fields therefore disagree about the
same field's value. **The search API is not a trustworthy instrument for this
measurement**; only the single-product endpoint should be used for any claim
about field availability.

## 5. The empirical check, stated precisely — and why it is weaker than it looks

- **Compared**: `nutriments['energy-kcal_100g']` × `serving_quantity` ÷ 100
  against `nutriments['energy-kcal_serving']`.
- **Sampled**: 186 products carrying both fields plus a numeric
  `serving_quantity`, across sodas/olive-oils/biscuits/milks.
- **Result**: 186/186 agreed within 2%, including products whose
  `serving_quantity_unit` is `ml`.
- **What it demonstrates**: OFF computes per-serving values as
  `_100g × serving_quantity / 100` *without regard to whether the serving unit
  is grams or millilitres*. So OFF's internal convention treats the `_100g`
  fields as "per 100 of the product's own quantity unit".
- **What it does not demonstrate**: anything independent about the physical
  label. `_serving` is **derived** from `_100g`, so the check is circular as
  proof of the denominator; it evidences OFF's arithmetic convention only.

Conclusion: this supports a per-100-product-unit reading **heuristically, as a
provider convention**, and does not prove it generally.

## 6. Counter-evidence against trusting a declared basis

Median `energy-kcal_100g` for olive oils, grouped by declared basis: `absent`
828 (n=77), `"100g"` 824 (n=17), `"serving"` 822 (n=5). Olive oil is ~884
kcal/100 g and ~810 kcal/100 ml. The declared flag produces **no separation**
in the numbers, and rows declaring `"100g"` carry values that look
volume-denominated. Contributors appear to transcribe the label's printed
figure regardless of which radio button they select.

(These are unpaired population medians across different products, so they are
suggestive, not conclusive — a paired test would need the physical labels.)

## 7. Frequency of the hard cases

From the correctly-projected joined run (100 products per category; treat the
absolute rates as indicative, given §4's caveat):

| | olive oils | milks | waters | biscuits |
|---|---|---|---|---|
| package unit is VOLUME | 91 | 67 | 86 | 0 |
| package unit is MASS | 0 | 22 | 1 | 95 |
| package VOLUME + declared `100g` | 15 | 25 | 16 | 0 |
| serving dimension conflicts with package dimension | 19 | 14 | 4 | 0 |
| no package unit, no serving unit, no declared basis | 5 | 7 | 8 | 1 |
| no `energy-kcal_100g` at all | 1 | 5 | 39 | 1 |

Two consequences worth weighing:

- The serving-vs-package conflict is common (14–19% in volume categories), so
  the "package is authoritative, discard the incompatible serving" rule is
  load-bearing rather than defensive. Concrete example: barcode
  `6111099000247` is a 500 ml olive oil whose `serving_quantity` is **900 g**.
- Treating "package in ml + declared `100g`" as an unresolvable contradiction
  would make roughly **1 in 5** volume products unloggable — while §6 suggests
  that declared `100g` is contributor noise rather than a genuine claim about
  the denominator.

## 8. Stronger independent signals not yet considered

- `packagings[]` — structured, taxonomised: `shape` (`en:drink-can`,
  `en:bottle`), `number_of_units`, `quantity_per_unit_value/unit`. Reliable for
  **container naming**, and a second opinion on package quantity. Says nothing
  about the nutrition denominator.
- `product_quantity` + `product_quantity_unit` — numeric and normalized,
  strictly better than re-parsing the free-text `quantity`.
- `serving_quantity` + `serving_quantity_unit` — recovers servings the current
  regex discards.
- `nutriments['energy-kcal_serving']` — not independent (derived, §5).
- `nutriments['energy-kcal_unit']` — the energy unit (kcal/kJ), not a basis.
- No field found that states the denominator independently of
  `nutrition_data_per`.

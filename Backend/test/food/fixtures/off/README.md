# Recorded Open Food Facts responses

These are real single-product API responses recorded on 2026-09-28 for
deterministic tests. Tests must mock `fetch` with these files and must not call
the live Open Food Facts service.

The capture used this `fields` filter:

`code,product_name,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,packagings,nutriments,nutrition_data_per,nutrition_data_prepared_per`

The 24 barcode-named files are found products. `not-found-6223001360018.json`
records a `status: 0` response.

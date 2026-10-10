# Label-scan numbers need two agreeing readings

A Label scan reads every number twice and keeps it only when the two readings agree digit for digit: once from a full-page recognition pass, and once from an English-only re-read of a small crop around the number. A number whose readings disagree, whose re-read finds no number or several, or that is written in Arabic-Indic digits, is never read — the field stays empty for the user to fill.

The rule exists because, measured on rendered Arabic, English and bilingual labels, Tesseract.js v7 produces confident wrong numbers in ways its confidence score doesn't flag: recognising with English and Arabic together turned "21 g" into "219" and "42%" into "4296"; the Arabic model truncated numbers on right-to-left lines to their last digit ("21" → "1", "12.5" → "5") at 95% confidence and reversed or misread Arabic-Indic digits ("١٠٠" → "٠٠١"); and at label resolution decimal points were dropped ("12.5 g" → "125g"). Each reading on its own was sometimes wrong, but the page and crop readings disagreed when one of them was — and a confidently wrong value pre-filled into the form is the failure the feature must not have (the release gate is zero wrong values marked "read").

So a scan runs one worker through an English page pass, an Arabic page pass (Arabic words only, merged with the English pass by position and confidence), and an English re-read per number. The cost is recall: on small or low-contrast print more numbers stay unverified and must be typed, and Arabic-Indic numerals are never read in v1. That trade was taken deliberately; tuning recall (image preprocessing, page segmentation, language data) belongs to physical-device validation on real labels, and must not loosen the agreement rule.

## Considered Options

- **Trust the page pass, gate on Tesseract's confidence** — rejected: the truncated and decimal-dropped numbers above were reported at 90%+.
- **Trust the crop re-read alone** — rejected: it also dropped decimals ("125g" for "12.5 g").
- **Upscale crops before re-reading** — tried and rejected: it made readings worse, including a confident wrong value.

## Later measurement: a cleaned copy of the photo

A photographed table with grid lines round every cell, a white-on-dark title bar, glossy foil and a few degrees of tilt read almost nothing from the photo as taken (3 to 7 of 10 row labels, no values), and no better binarised or upscaled. Every pass now reads a cleaned copy made on the device from the photo (`labelCleanup.ts`): straightened by the tilt of its grid lines, the title bar turned dark-on-light, the grid lines erased, the lighting evened out. On that label the same engine then read every row label and most values. The copy is read as sparse text, because a table read as one block runs its cells together.

The agreement rule is unchanged: a number is read only when the page reading and the re-read agree digit for digit. Two details follow from the cleaned copy and don't loosen it:

- The re-read is now of the number's own ink, cropped tight (a box that reaches over the next row or the unit beside it made the single-line read drop decimal points) and enlarged to about 65 px tall. The earlier finding that upscaled crops read worse was made on crops of the photo itself; on the cleaned copy a moderate enlargement keeps decimal points, and a large one (90 px) misreads digits, so the size is a measured middle.
- A point read as a comma by one reading ("78,76" and "78.76") agrees, since the reader takes either as the decimal point. A whole number with a leading zero ("02", the "0.2" a glare spot ate the point of) is never read.

The copy is used only on a photo that has a table grid; a photo with no grid, or one whose copy can't be made, is read as before. The re-read is cut from the copy as it was before its grid lines were erased, and a number whose ink the erasure touched is never read, because two readings of one cut digit prove nothing.

These settings (copy only on gridded photos, sparse mode, about 65 px re-read, the pre-erasure re-read, the cleanup in a worker) were measured on renderings of one photographed table and still need the #39 real-label gate (`docs/label-scan-release-checks.md`); the release gate is unchanged: zero wrong values marked "read".

## Later measurement: a unit read as a bracketed digit

On a bilingual table the row label's "(g)" is often read as "(2)" or "()". The number beside it still agreed digit for digit, but with no unit the reader left it blank without a word of explanation. Two changes follow, and neither relaxes the agreement rule:

- A word that is a lone digit in brackets ("(2)") is never verified, is never taken as a value, and a row with a number but no readable unit now says so.
- One unit is assumed, always flagged: grams, marked "needs check" ("Unit not read — assumed g from the per 100 g table"). The guards, all required: the table is headed per 100 g; the nutrient is protein, carbs, sugars, fat or fiber (never energy, sodium or anything that could print mg or kJ); the number passed both readings and every value check; a bracketed scrap ("(2)", "()") sits where the "(g)" was printed; and no recognised or unrecognised unit word is beside the number. A number with no unit and no such scrap stays blank.

## Nutrient-per-column tables

Some labels put each nutrient in a column. This pass requires at least two distinct nutrient headings with their own basis or unit evidence, or a per-100 title directly above them. Every recognised nutrient heading owns a bounded horizontal band, including nutrients without form fields. Arabic subheadings join an English column only with clear horizontal overlap; an unmatched Arabic nutrient subheading leaves the table unresolved. The number of Western-number cells in the first nearby value row must equal the heading count; a second prose-free numeric row before the footer, a second evidenced heading row, or any per-serving phrase in the title or headings leaves the whole table unresolved. Only that first value row can supply values; Arabic-Indic copies and later footer numbers cannot.

Each cell must have one Western number that passes the independent two-reading rule. Its centre must sit within the span of the English keyword and its basis words, or the matched Arabic keyword when wider. Nutrient unit words never widen this placement span. The span gets one quarter of the typical column gap as an allowance, capped at the midpoint toward either neighbouring heading span. Arabic unit words belong to the subheading whose words they overlap; adjacent units with no overlap join the nearest unambiguous Arabic subheading. A less-than bound or percent is never an exact value, and a number straddling two bands leaves both neighbours blank with a warning. The basis number and its unit are not nutrient values or unit evidence. Sodium and other nutrients that may use mg require an explicit nutrient unit; gram nutrients with only their own `/100g` basis as unit evidence may be filled as g only with a needs-check warning. Conflicting bases or units leave the affected nutrient blank. Energy headed only in kJ stays blank rather than being converted. Review evidence stays in photo coordinates, and the release gate remains zero wrong values marked "read".

A nutrient row with its own per-serving phrase or non-100 mass or volume basis stays not-found with a manual-entry warning, even if another value follows. A transposed title or heading with such a basis leaves its table unresolved and warns on its fields. An exact per-100 g or per-100 ml basis remains eligible. No serving value is converted into a per-100 value.

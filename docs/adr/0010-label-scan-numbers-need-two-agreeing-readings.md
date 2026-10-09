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

If the copy can't be made, the photo itself is read as before.

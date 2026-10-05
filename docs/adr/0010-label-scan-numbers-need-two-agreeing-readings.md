# Label-scan numbers need two agreeing readings

A Label scan reads every number twice and keeps it only when the two readings agree digit for digit: once from a full-page recognition pass, and once from an English-only re-read of a small crop around the number. A number whose readings disagree, whose re-read finds no number or several, or that is written in Arabic-Indic digits, is never read — the field stays empty for the user to fill.

The rule exists because, measured on rendered Arabic, English and bilingual labels, Tesseract.js v7 produces confident wrong numbers in ways its confidence score doesn't flag: recognising with English and Arabic together turned "21 g" into "219" and "42%" into "4296"; the Arabic model truncated numbers on right-to-left lines to their last digit ("21" → "1", "12.5" → "5") at 95% confidence and reversed or misread Arabic-Indic digits ("١٠٠" → "٠٠١"); and at label resolution decimal points were dropped ("12.5 g" → "125g"). Each reading on its own was sometimes wrong, but the page and crop readings disagreed when one of them was — and a confidently wrong value pre-filled into the form is the failure the feature must not have (the release gate is zero wrong values marked "read").

So a scan runs one worker through an English page pass, an Arabic page pass (Arabic words only, merged with the English pass by position and confidence), and an English re-read per number. The cost is recall: on small or low-contrast print more numbers stay unverified and must be typed, and Arabic-Indic numerals are never read in v1. That trade was taken deliberately; tuning recall (image preprocessing, page segmentation, language data) belongs to physical-device validation on real labels, and must not loosen the agreement rule.

## Considered Options

- **Trust the page pass, gate on Tesseract's confidence** — rejected: the truncated and decimal-dropped numbers above were reported at 90%+.
- **Trust the crop re-read alone** — rejected: it also dropped decimals ("125g" for "12.5 g").
- **Upscale crops before re-reading** — tried and rejected: it made readings worse, including a confident wrong value.

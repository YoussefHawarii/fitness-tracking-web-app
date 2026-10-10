# Label scan: release checks and tuning record (#39)

Nutrition-label scanning (#29) is not released until the checks below pass on
physical phones and a preview deploy. Automated tests cannot prove real
recognition accuracy, camera and gallery behaviour, HEIC decoding, device
memory, cellular download time, or the CSP with real third-party sign-in.

## Real-label fixtures

1. Photograph about 15 real retail labels, at least 5 of them Arabic or
   bilingual, with clear, glossy, curved, low-light and per-serving-only
   examples.
2. From `Frontend/`, start the dev server with `npm run dev`. Then open
   `/scripts/label-fixture/` on it and pick the photos. The page runs the
   app's own pipeline in the browser, the same way the app does: it
   prepares each photo (orientation, resize, grayscale) and reads it with
   the on-device engine and the self-hosted language data. Nothing is
   uploaded. Each photo downloads as a `<name>.json` fixture.
3. Put the downloads in `test/fixtures/labels/pending/` (gitignored). Fill
   in every `TODO` from the printed label, never from the OCR output:
   - every nutrient value from the per-100 column, or from the per-serving
     column on a per-serving-only label;
   - the serving size and the package size with their printed unit, for
     example `{ "value": 30, "unit": "g" }`;
   - `null` for anything not printed.

   Review the whole file, then move it into `test/fixtures/labels/`.
4. Photos are not committed unless the owner chooses to commit them.
5. Run `npm test`. `test/label-fixtures.test.mjs` checks every committed
   fixture against the release targets:
   - No wrong value is marked "read" in any field.
   - Per-serving-only labels never fill per-100 fields.
   - On clear labels, at least 80% of calories, protein, carbs and fat are
     read from a per-100 column on the label's own basis.

The fixture page reads whole photos only, so it does not exercise the label
camera or region reads. Those are checked on the phones, below.

The shipped app has no OCR export or debug path. The page lives outside
`src/`, and the production build only bundles the app's own `index.html`.

## Tuning record

**Confidence threshold:** stays at 70 (`MIN_NUMBER_CONFIDENCE`) until real
fixtures exist. Any change must keep zero wrong "read" values across the
real-label set, and must not loosen ADR 0010.

**Tooling check on rendered labels (not real labels):** a crisp,
computer-rendered bilingual per-100 g label was run through the script.

- At 26 px text, 0 of 4 main values were read.
- At 52 px text, 1 of 4 main values was read (calories).
- No wrong value was ever marked "read".

Every miss was an OCR misread that the reader correctly refused:

- "keal" for kcal
- "71g" or "7149" for 7.1 g
- "2409" for 24.0 g
- "16.29" or "16.2 ¢" for 16.2 g

Both readings agreed on "16.29", where the unit "g" was read as a 9, so only
the rule that a unit must sit beside its number kept it out. That rule must
not be relaxed.

Expect recall on real labels to fall short of the 80% target. Measure it
with real fixtures before release. Tuning against rendered labels would not
show whether the real target is met.

**Bilingual cookie table, one numeric column (v0.2.16):** a photographed
table with an English label on the left, Arabic on the right and one value
column read as `no-per-100-column`, so every value was "for reference only".
Five changes, none of which loosens the agreement rule (ADR 0010):

- F1, merge: an Arabic unit word ("جم") no longer removes a purely numeric
  English-pass word on its ink. It had taken the "100" of the per-100 heading
  with it. Any other Arabic word still contests by confidence, so digit junk
  read on Arabic text is removed as before.
- F2, headings: a bare "%" heads a percent column only on a row that has
  another value heading ("Per 100 g   %"); alone on its row it is noise. A stray
  "%" above the table had overlapped the per-100 heading and left the table
  unresolved. "daily", "reference" and "intake" count only as a pair ("daily
  value", "reference intake") or beside a "%". Per-100 and per-serving
  detection is untouched.
- V, verification: a word that is a lone digit in brackets ("(2)", a "(g)" misread)
  or holds letters that are not a unit ("39M") is never verified, even when both
  readings agree.
- A, warning: a row whose number has no readable unit now says "Couldn't read
  the unit — check this value." instead of staying blank with no explanation.
- B, assumed grams: only on a per 100 g table, only for protein, carbs, sugars,
  fat and fiber, and only when a bracketed scrap ("(2)", "()") sits where the
  "(g)" was printed and nothing else could be the unit, a verified number is
  filled as grams and marked "needs check" ("Unit not read — assumed g from the
  per 100 g table"). Energy, sodium and every other table stay blank. A number
  with no unit and no scrap before it also stays blank. This is the one place
  a unit is assumed, so it is always flagged; a number whose own word carries a
  misread "g" ("16.29") is still caught by the digit-agreement rule as before.

Unchanged: a page reading with a dropped decimal point still disagrees with
its crop ("651" vs "6.51" stays unverified), a whole number with a leading
zero ("02") is never read, `MIN_NUMBER_CONFIDENCE`, and the cleanup ink threshold.

**Default vs fast language data:** keep the default `4.0.0_best_int` data.

- The packaged sets are `4.0.0_best_int` (eng 2.95 MB + ara 1.66 MB gzipped)
  and `4.0.0` (eng 10.9 MB, which also carries the legacy engine). The
  default is already the smallest packaged set.
- The "fast" models (tessdata_fast) are not packaged and would have to be
  self-hosted separately.
- Per the spec's rule, switch only if a device measurement shows fast data
  is faster, close to the 15 s target, and still produces zero wrong "read"
  values on the real fixtures.

First-scan download, for reference: worker 0.11 MB, one engine build about
3.9 MB before HTTP compression, and 4.6 MB of language data.

## Physical-phone matrix (outstanding)

**Devices**

- [ ] iPhone Safari, current iOS
- [ ] iPhone Safari, one major version back
- [ ] Android Chrome, mid-range
- [ ] Android Chrome, low-end
- [ ] Desktop Chrome (file pick only)
- [ ] Desktop Firefox (file pick only)

**Cases (run on each device and record the result)**

- Camera capture
- In-app label camera: opens with the permission prompt
- In-app label camera: the resolution it actually delivers (log or inspect
  the captured photo's size)
- In-app label camera: 2x zoom and continuous focus on Android
- In-app label camera: on iPhone Safari there is no zoom control (the frame
  stays at 1x, so move closer), focus is automatic (no tap-to-focus in the
  web viewfinder) and the resolution is often about 1080p; passes if the
  table inside the frame is sharp and readable
- In-app label camera: flashlight turns on and off
- In-app label camera: the tall and wide frames match what is captured
- In-app label camera: a captured photo is read immediately, with no crop
  step
- In-app label camera: with camera permission denied, "Take photo" and
  "Choose photo" are offered and work
- Gallery pick
- HEIC photo
- Rotated or EXIF-oriented photo
- Glossy or curved pack
- Low light
- Blur
- English-only label
- Arabic-only label
- Bilingual label
- Single per-100 column
- Per serving + per 100 + %RI
- Per-serving-only label
- Side-by-side rows
- kJ + kcal
- "<0.5 g"
- Liquid per 100 ml
- Cancel mid-scan
- Retake mid-scan
- Editing a field during a scan
- First scan on mobile data
- Second scan from cache
- Google sign-in, avatars and the barcode scanner under the CSP
- Network inspection

**Pass criteria**

- [ ] 0 wrong values marked "read" across the real-label set
- [ ] At least 80% of calories, protein, carbs and fat read on clear labels
- [ ] Per-serving-only labels never fill per-100 fields
- [ ] First-scan download within about 15 s on 4G
- [ ] No tab crash or reload on either iPhone across 5 consecutive scans
- [ ] No tab crash or reload on either iPhone across 5 consecutive in-app
      label camera scans (full-resolution crops use more memory)
- [ ] Clean-profile network inspection on every device. The only requests
      during capture, scan, cancel and apply are same-origin OCR asset
      requests. The only request carrying product data is the create-product
      request after Create product is pressed.

**Preview deploy:** sign-in, avatars, barcode scanning and OCR all work under
the enforced Content-Security-Policy.

Already verified locally with `vite preview` and the enforced CSP: OCR runs,
the Google sign-in iframe and fonts load, and the only violation was the
local build calling `localhost:3000`, which is expected.

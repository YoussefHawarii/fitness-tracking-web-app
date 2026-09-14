# Food Log Input Modes — Diagnosis & Fix Design
## Scan, Voice, and Manual Search (Calorie & Weight Tracking Web App)

**Status:** Diagnosis complete, fix design proposed, **not yet implemented**. This document is the
required design step before any GitHub issues are opened for this work (per project owner's request).

### 0. Method

Three problems were reported against the Log Food page (`Frontend/src/pages/FoodLog.tsx`): barcode scan
does nothing after a successful decode, voice input doesn't support Arabic, and manual search returns
noisy near-duplicate results instead of one canonical item. Each was investigated by:

- Tracing the actual code path end to end (frontend component → service → backend controller → service →
  external API client → Prisma schema).
- Reading the installed `@zxing/browser` library's own source (`Frontend/node_modules/@zxing/browser/esm/readers/BrowserCodeReader.js`) rather than assuming its documented behavior.
- Live `curl` tests against the real Open Food Facts API (single lookup, a rapid-repeat sequence, and a
  plausible not-in-database barcode) to check real-world behavior rather than guessing.
- An independent, read-only second-opinion review by Codex (OpenAI's coding CLI), given the same repo and
  asked to re-derive the diagnosis from scratch and challenge every claim. Its findings — several of
  which corrected or sharpened the initial diagnosis — are folded into the sections below.
- A second independent, read-only review pass specifically of this written document, done via OpenCode
  (a separate agent CLI) after Codex's own usage limit was hit mid-way through that second pass. This
  review caught a real overstatement in the original §3.3 (corrected below, and independently re-verified
  live against USDA's real search API before accepting the correction), a wrong Prisma line citation, and
  two gaps in §4's decision list — folded in below and called out where relevant. Its own claims were,
  in turn, re-verified against the source files and a live API call rather than taken on faith.

No source files were modified as part of this investigation (aside from this new doc).

---

### 1. Barcode Scan — "nothing happens after a successful scan"

**User's report:** camera works, but after scanning a barcode nothing happens — no item gets added, and
there's no visible way to search for the item instead.

#### 1.1 What's actually wired up (confirmed correct)

The intended chain is real and has no dead code:
`BarcodeScanner.tsx` decodes a frame → calls `onDecoded(text)` → `FoodLog.tsx`'s
`handleBarcodeDecoded` (`Frontend/src/pages/FoodLog.tsx:128-137`) calls `lookupBarcode()` → on a match,
`setPendingItem(...)` shows the shared grams + meal-category card; on no match, it sets a status message
and switches to the Manual tab. The backend route is authenticated normally (`JwtAuthGuard` on the whole
controller, `Backend/src/modules/food/food.controller.ts:27-38`) and a successful `OPEN_FOOD_FACTS`
lookup flows correctly through DTO validation, nutrient resolution, and persistence
(`Backend/src/modules/food/food.service.ts:47-55`, persisted as `FoodLogEntry` at
`Backend/prisma/schema.prisma:231-250`).

So the bug isn't a broken wire — it's what happens when this chain runs for real, repeatedly, against
real network services with real limits.

#### 1.2 Root cause #1 (primary): the scanner never stops, and that can starve both APIs

`BarcodeScanner.tsx:14-31` calls `reader.decodeFromVideoDevice(...)` and only saves the returned
`controls` for use on unmount — it never calls `controls.stop()` after a successful decode. Looking at
the library itself confirms this matters: its continuous scan loop
(`@zxing/browser/esm/readers/BrowserCodeReader.js:1074-1143`) re-arms itself via
`setTimeout(loop, delayBetweenScanSuccess)` — **500ms** — after *every* successful decode, and the
library ships a separate `scanOneResult` API (`BrowserCodeReader.js:1035-1066`) that *does* call
`controls.stop()` on first success specifically for one-shot use (`BrowserCodeReader.js:1046`), which this
app never calls. In other
words: as long as the barcode stays in frame (the natural thing to do while waiting for something to
happen), the app keeps re-decoding it roughly twice a second, and every single decode re-fires
`handleBarcodeDecoded` with no de-dupe, no "already looking this up" guard, and no cancellation of
in-flight requests (`FoodLog.tsx:128-137`).

That matters because two real request limits sit downstream:

- **The app's own rate limiter**: 50 requests per rolling 5 minutes, keyed per authenticated user
  (`Backend/src/app.module.ts:21-24`, `Backend/src/common/guards/user-throttler.guard.ts`). At ~2
  requests/second, one held barcode can burn through that allowance in **about 25 seconds**.
- **Open Food Facts' own published limit**: 15 product-read requests per minute per IP
  ([openfoodfacts.github.io/openfoodfacts-server/api](https://openfoodfacts.github.io/openfoodfacts-server/api/)).
  Since all lookups are proxied through our backend, every user's scan traffic shares the backend's one
  outgoing IP — so this limit can be hit even faster, and is shared across whoever else is using the app
  at the same time. The client also doesn't send OFF's requested identifying `User-Agent` header
  (`Backend/src/modules/food/clients/open-food-facts.client.ts:24-29`), which OFF's own guidance asks
  integrators to include.

The consequence lands squarely on the user's exact complaint: `handleSaveLog` → `createFoodLog` →
`resolveNutrients` performs a **second**, independent Open Food Facts lookup for the same barcode at save
time rather than reusing the product already resolved during scanning
(`Backend/src/modules/food/food.service.ts:42-55`, `87-110`). So even in the best case — the scan
succeeded and the grams/meal card appeared — pressing **Save** can still fail if the scan loop has
already spent the rate-limit budget, and the user sees nothing but a generic
`'Could not save this entry.'` (`FoodLog.tsx:165-167`), indistinguishable from every other failure mode.
The same re-resolve pattern also runs on **edit**, not just initial save — `updateFoodLog` re-calls
`resolveNutrients` for the entry's existing `sourceType`/`sourceRef` rather than trusting the previously
computed values (`Backend/src/modules/food/food.service.ts:123-141`, specifically the `resolveNutrients`
call at `:137-141`) — so editing an already-saved scanned entry carries the identical second-lookup /
rate-limit exposure as the original save.

#### 1.3 Root cause #2 (compounding): every failure mode looks like "product not found"

`lookupBarcode()` on the frontend wraps its request in a blanket `try/catch` and returns `null` on
**any** error (`Frontend/src/services/foodService.ts:28-38`) — a real 404, an expired/invalid auth token,
a backend 500, our own 429 rate-limit response, OFF's 503, a CORS failure, and an offline network error
all collapse into the exact same "no product found" outcome. Combined with root cause #1, a user who
triggers the app's rate limit by holding a barcode in frame doesn't see "you're being rate-limited, wait
a moment" — they see the same muted, easy-to-miss status line as a barcode that's genuinely not in Open
Food Facts' database (see 1.4).

Separately: `BarcodeScanner.tsx:18-27` only inspects the `result` argument of the zxing callback and
ignores the `error` argument entirely. Per the library's own loop (`BrowserCodeReader.js:1118-1139`),
most decode misses are retryable (`NotFoundException`/`ChecksumException`/`FormatException` — normal,
expected while no barcode is in view) and the loop keeps going — but a **non-retryable** error ends the
scan loop silently, with zero UI feedback that scanning has stopped. This is a second, independent way
for "nothing happens" to occur even before a barcode is ever successfully decoded.

#### 1.4 Root cause #3 (real for this user specifically): weak fallback UI + likely frequent not-found

When `lookupBarcode()` genuinely returns `null`, the *only* UI change is one muted-gray status line below
the mode card (`"No product found for that barcode — try manual entry."`) plus a silent tab switch to
Manual (`FoodLog.tsx:128-133`, rendered at `190-220` / `249`) — no banner, no auto-focus into the search
box, nothing that reads as "here's a button." A live test against the real Open Food Facts API confirms
this is a **likely frequent** outcome for this user specifically: a plausible Egyptian-market barcode
(`6221031002229`) returned `status: 0` (not found) against OFF's live API, consistent with OFF's much
sparser coverage of regional/local products outside the US/EU. So a large fraction of this user's real
scans are likely hitting exactly this weak fallback path, which reasonably reads as "nothing happens" —
especially combined with 1.2's rate-limit risk misreporting as the same message.

On the success side, Codex's review flagged something the first pass missed: even when a product *is*
found, the pending-item card is inserted **below** the still-running, still-visible camera feed
(`FoodLog.tsx:190-200` render the scanner; `222-246` render the card underneath), with no scroll-into-view
and no inline "✓ Found: X" confirmation inside the scan card itself. A user staring at the camera,
expecting *something to change in the frame*, could easily miss a card that appeared below it.

#### 1.5 Two more real, smaller defects found in review

- **React StrictMode double-invocation (dev only):** `Frontend/src/main.tsx` renders under StrictMode,
  which intentionally mounts→unmounts→remounts effects once in development. Because
  `BarcodeScanner.tsx`'s effect assigns `controls` *asynchronously* (`.then((c) => { controls = c; })`)
  but the cleanup function only stops `controls` if it's already been assigned by the time cleanup runs,
  the first camera stream/scan loop can leak and run alongside the second, causing duplicate/overlapping
  scans specifically in local dev. Not the production root cause, but worth fixing as part of the same
  change (fix it and the leak class disappears for free) and worth knowing about if diagnosing dev-only
  weirdness later.
- **Silent zero-calorie products:** if OFF has a product but no calorie data on it, the app accepts
  `caloriesPer100g: 0` without any warning (`Backend/src/modules/food/clients/open-food-facts.client.ts:47`).
  Not part of "nothing happens," but a real data-quality gap worth a one-line fix alongside this work. The
  same silent-zero pattern exists on the USDA side too — see the correction in §3.3 (this was originally
  written up as a unit-ambiguity risk; a live USDA FoodData Central query during review found that's not
  actually the failure mode here — the real, confirmed issue is just the missing-nutrient zero-default).

#### 1.6 Recommended fix (design, not yet built)

1. **Stop the scanner on first success.** Call `controls.stop()` inside the decode callback as soon as a
   result comes back, before doing anything else. This alone removes most of the request-storm risk.
2. **Add a parent-level single-flight guard** in `handleBarcodeDecoded` (e.g. an in-flight/last-barcode
   ref) so even a near-duplicate decode within the same tick can't trigger overlapping lookups, and so a
   slow response can't be overwritten by a stale one.
3. **Stop misclassifying failures.** Have `lookupBarcode()` distinguish "confirmed not found" (backend
   404 / OFF `status:0`) from everything else (network error, our own 429, OFF 503/429, auth failure), and
   surface the latter as an honest "couldn't check right now — try again in a moment" rather than "not
   found."
4. **Reuse the resolved product at save time (and on edit)** instead of re-fetching OFF inside
   `resolveNutrients` for `OPEN_FOOD_FACTS` entries — the same fix needs to cover both `createFoodLog` and
   `updateFoodLog`, since both call `resolveNutrients` (§1.2). This is a real design fork, not a detail —
   see §4: **pass the already-fetched nutrients through** in the save/update request payload (changes the
   DTO shape, and re-raises the "don't trust client-supplied nutrient data" question) **vs. cache the
   looked-up product server-side briefly**, keyed by barcode (adds cache staleness/invalidation and
   cross-user cache-sharing questions, since a barcode's product data isn't user-specific). Pick one before
   implementation.
5. **Make both outcomes visually obvious inside the scan card itself:** on success, show an inline
   "✓ Found: {name}" state and scroll/focus the grams field; on not-found (confirmed, not just
   "something went wrong"), show a prominent action — not a muted caption — that switches to Manual with
   the scanned code/product name (if any) pre-filled, plus an explicit "Scan again" option.
6. **Log/surface non-retryable zxing errors** (from the callback's `error` argument) instead of letting
   the scan loop die silently.
7. Fix the StrictMode double-effect leak (guard the cleanup to always stop whatever stream/controls
   exist, synchronously tracked, not just the async-assigned local).

**Testing seams** (this repo runs Jest unit specs — `*.spec.ts`, CI-enforced — and Jest e2e specs —
`*.e2e-spec.ts`, run locally per `AGENTS.md`; there's already a same-domain precedent at
`Backend/test/food-logs-edit-delete.e2e-spec.ts` and `Backend/test/food/food-log-edit-delete.spec.ts` to
extend or sibling): the classification fix in item 3 and the reuse-at-save/edit fix in item 4 are
backend-only and belong alongside those existing food e2e specs — straightforward to assert against
`FoodService`/`FoodController` without a browser (mock the OFF client to return a 429/503/network-error and
assert the controller responds distinctly from a real 404; assert `createFoodLog`/`updateFoodLog` don't
issue a second OFF call once the reuse mechanism from §4 is picked). Items 1, 2, 5, 6, 7 are frontend
behavior (`BarcodeScanner.tsx`/`FoodLog.tsx`) with no existing frontend test runner configured in
`Frontend/package.json` today — those seams would need either a manual verification pass or introducing
frontend testing infrastructure first, which is a decision of its own, not assumed here.

---

### 2. Voice — Arabic (incl. Egyptian dialect) support + category selection

**User's report:** voice only works in English; wants Egyptian Arabic support; wants a
breakfast/lunch/dinner/snack category choice after transcription.

#### 2.1 The category picker already exists — confirmed

Selecting any voice match (`VoiceLogger.tsx:81-93`, `113-126`) calls the same shared handler used by
barcode and manual (`FoodLog.tsx:139-141` → `handleUsdaMatchSelected`), which renders the existing
grams + Breakfast/Lunch/Dinner/Snacks `<Select>` + Save card (`FoodLog.tsx:222-246`). This matches
`specs/005-manual-food-log-search/spec.md:94-98`'s own explicit assumption that meal-category selection
is already implemented and working for voice- and barcode-sourced entries. **No new category-picker UI
needs to be built** — the gap is discoverability (it only appears after confirming the transcript,
searching, and picking a specific food match — several steps after recording, and below up to 5 results
with no auto-scroll), not a missing feature.

#### 2.2 The Arabic gap is a documented regression, not a new ask

`Frontend/src/features/voice-logger/VoiceLogger.tsx:9-14` hardcodes:

```ts
const SPEECH_RECOGNITION_LOCALES: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE',
};
```

with no `ar` entry, so `recognition.lang` (`VoiceLogger.tsx:59-62`) always falls back to `'en-US'`
regardless of the account's language preference — and Arabic isn't even offered as an account language
option today (`Frontend/src/pages/Account.tsx:29-38`, `LANGUAGE_OPTIONS`). This is notable because the
project's **own docs already specified this**:

> "Voice logging path: 1. Record audio → transcribe via Web Speech API (`lang: ar-EG`)."
> — `docs/business-logic.md:48-53`

> "Speech recognition accuracy for Egyptian Arabic dialect: to be validated with a quick manual test
> (Web Speech API, `lang: ar-EG`, real dialectal phrases) before building the feature. ... If accuracy
> proves too poor, fallback is a self-hosted Whisper model."
> — `docs/requirements-spec.md:55-56` (listed under "Open Questions — not yet decided")

So `ar-EG` was the intended value from the start; it was simply never wired into the locale map, and the
accuracy validation the requirements doc calls for was never done. This is a gap against the project's
own spec, not scope creep.

#### 2.3 What `ar-EG` alone does and doesn't get you

Setting `recognition.lang = 'ar-EG'` is necessary but **not sufficient**:

- It's a valid BCP-47 tag the Web Speech API accepts, but neither this project nor the browser vendors
  guarantee transcription *accuracy* for Egyptian colloquial speech specifically (vs. Modern Standard
  Arabic) — hence the requirements doc's own "open question" framing. This should be spot-checked with
  real phrases (e.g. "أكلت صدر فراخ مشوي" / "شربت عصير مانجا") before considering the feature done.
- Browser support is uneven: Chrome/Edge support `SpeechRecognition` (Chrome's implementation can call out
  to a server-side recognition service, so it needs connectivity); Firefox supports it only behind a
  preference flag; Safari/iOS Safari support it via the prefixed `webkitSpeechRecognition`, added in
  Safari 14.1/iOS 14.5, but require Siri to be enabled on-device. A secure context (HTTPS, or `localhost`)
  is required — plain HTTP on a LAN/other hostname won't work. (Sources:
  [MDN SpeechRecognition compatibility](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition),
  [WebKit Safari 14.1 announcement](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/).)
  `VoiceLogger.tsx:20-29, 65-70` currently collapses every failure mode (`language-not-supported`,
  mic-permission-denied, `audio-capture`, network error) into one generic "Could not transcribe" message —
  worth distinguishing at least "microphone blocked" from "language not supported" from "network error."
- **Critically: an Arabic transcript alone doesn't produce useful search results today.** The confirmed
  transcript is sent unchanged to `searchUsda()` (`VoiceLogger.tsx:81-90` → `foodService.ts:41-46`) →
  USDA FoodData Central, whose content is English-only. Arabic speech recognition and Arabic food-name
  resolution are two separate problems — see §3, which both modes need to share a fix for.
- The requirements doc also describes parsing the confirmed transcript into **individual food terms**
  before searching (`docs/business-logic.md:48-53`, step 3) — e.g. "chicken and rice" → two searches. The
  current implementation sends the whole transcript as one query and only tracks one pending item at a
  time (`VoiceLogger.tsx:81-90`, `FoodLog.tsx:31-34`). Worth deciding whether this stays in scope now or
  is tracked separately — it's a real gap against the existing spec either way.

#### 2.4 Recommended fix (design, not yet built)

1. Add `ar: 'ar-EG'` to `SPEECH_RECOGNITION_LOCALES`, and add Arabic to `Account.tsx`'s
   `LANGUAGE_OPTIONS` (the backend already accepts any non-empty string for `languagePreference` —
   `Backend/src/modules/users/dto/update-preferences.dto.ts:9-12` — so this is purely a frontend change).
   Consider a dedicated in-page voice-language toggle rather than only the account-wide preference, so a
   bilingual user isn't forced to switch their whole account language just to dictate in Arabic once.
2. Do the manual dialect-accuracy spot check the requirements doc calls for, before calling this done;
   note the result (and the Whisper-fallback contingency, if accuracy is poor) in this doc or a follow-up.
3. Distinguish speech-recognition error types in the UI instead of one generic message.
4. Route the transcript through the shared bilingual food resolver described in §3 rather than straight
   to `searchUsda()`, so Arabic speech and Arabic typed search behave identically.
5. Add `dir="auto"` to the transcript/search text fields so Arabic text displays correctly without a full
   app-wide RTL/i18n overhaul (full UI translation is a separate, much larger effort and is **not**
   required just to accept Arabic speech and search — there is currently no i18n library installed at
   all, confirmed via `Frontend/package.json`, and building one out is out of scope for this fix).
6. Decide separately whether transcript-splitting into multiple food terms (business-logic.md's step 3)
   is in scope now or tracked as its own follow-up.

**Testing seams:** item 4 (routing through the shared resolver) is the one backend-testable piece here —
once §3's shared resolver exists, an e2e spec asserting an Arabic query string returns the expected
canonical match covers both this item and §3's resolver at once. Items 1, 2, 3, 5 are browser-only
(`SpeechRecognition` is not available under Jest/jsdom) — the dialect-accuracy check in item 2 in
particular can only be validated manually, in a real browser, with real audio input; it isn't something
a test suite can assert.

---

### 3. Manual Search — one canonical item per food + bilingual (English/Arabic) search

**User's report:** searching "chicken breast" shows many separate entries with different calories/
categories instead of one canonical item; wants to search (and voice-dictate) in both English and Arabic.

#### 3.1 Why this happens today (confirmed, and deliberate under the current spec)

`ManualFoodSearch.tsx:26-38` calls `searchUsda(term)` → `Backend/src/modules/food/clients/usda.client.ts:39-61`,
which does a live, unmodified, English-only query against USDA FoodData Central
(`GET /foods/search?query=<term>&pageSize=5`) and maps up to 5 raw results 1:1 into the list the UI shows
(`ManualFoodSearch.tsx:73-86`). There is no de-duplication, no canonicalization, no ranking beyond USDA's
own result order. There is also **no canonical/shared foods table** on our side — the only persisted food
record is `LocalFoodItem`, which is private per-user, fallback-only data with a single `name` field and
no Arabic-name or barcode field (`Backend/prisma/schema.prisma:215-229`).

This is the literal, direct cause of "many chicken breast items with different calories" — and per
`specs/005-manual-food-log-search/spec.md:56-61, 94-99`, it's the **existing spec's own explicit,
deliberate design**: present multiple distinguishable candidates, never silently auto-select one. So this
isn't a bug against spec 005 — it's a product-direction change the user is now asking for, on top of that
spec.

#### 3.2 Two architecture options considered

**Option A — curated bilingual canonical catalog (recommended).** Add a small global `CanonicalFood`
table (+ alias table) server-side: one row per generic food (e.g. "chicken breast, raw"), with English
and Arabic (MSA + common Egyptian, e.g. دجاج/فراخ) names and aliases, per-100g nutrients, and — where
nutritionally meaningful — an explicit preparation-state distinction (raw vs. cooked/grilled, with/without
skin), rather than pretending those are interchangeable. Manual search and Voice both call **one shared
backend search endpoint** that checks canonical aliases first (normalized for case/diacritics/alef-ya
variants), then the user's own private `LocalFoodItem`s (currently not searched by Manual at all — a gap
worth closing regardless: `listLocalFoodItems()` already exists in `foodService.ts:59-62` but
`ManualFoodSearch.tsx` never calls it), then falls back to live USDA search only for the long tail of
foods not in the curated set.

*Why recommended:* deterministic, cheap, fully within the project's existing $0/month hosting constraint
(`docs/requirements-spec.md:49-53`), directly encodes Egyptian-Arabic vocabulary instead of depending on
machine translation quality for it, and is easy to test. USDA FoodData Central data is public
domain/CC0 and may be incorporated with attribution
([USDA FDC API guide](https://fdc.nal.usda.gov/api-guide/)). Trade-off: a seed catalog only covers what's
been curated — reaching broad "everyday foods" coverage (spec 005's own 90% target,
`specs/005-manual-food-log-search/spec.md:85-92`) means defining a target food list and growing it over
time, not a one-shot build.

**Option B — live Arabic→English translation + USDA de-dup/ranking.** Keep USDA as the only data source;
translate the query server-side, then rank/collapse USDA's results (filter branded/prepared noise for a
generic query, merge near-duplicates). Broader raw coverage, but less reliable in practice: Egyptian
colloquial food terms can mistranslate, many of USDA's "different calories" results reflect genuinely
different preparations rather than removable duplicates (so de-dup logic itself becomes a fuzzy, ongoing
judgment call), and it adds a translation-service dependency (latency, an API key/credential to manage,
and — despite being framed as "free" — a *monthly allowance*, not a permanent guarantee: e.g. Google
Cloud Translation's first 500,000 characters/month before $20/million
([pricing](https://cloud.google.com/products/translate/pricing)), or DeepL API Free's 500,000
characters/month ([usage limits](https://developers.deepl.com/docs/resources/usage-limits)) — with
Arabic/dialect quality for food terms unverified either way).

**Recommendation:** build Option A first; keep Option B (or a lighter version — translate only as a
fallback when the canonical catalog and USDA-by-English-term both come back empty, with results cached)
as an optional later enhancement rather than the primary mechanism.

#### 3.3 One data-quality bug worth fixing in the same pass

**Corrected during review** (see §0 — the original draft of this section overstated the risk; the actual
bug is narrower than first written). `Backend/src/modules/food/clients/usda.client.ts:24-28, 53, 85`
(`extractNutrient`) matches nutrients by exact name — `"Energy"`, `"Protein"`, `"Carbohydrate, by
difference"`, `"Total lipid (fat)"` — and falls back to `null`/`0` (`?? 0` specifically for calories) when
no match is found. A live query against USDA FoodData Central's real search API during this review
(`GET /foods/search?query=chicken%20breast`) confirmed that the nutrient literally named `"Energy"` in FDC
data is a single, unit-stable **KCAL** value per record — FDC's alternate-calculation-method entries carry
different names entirely (e.g. "Energy (Atwater General Factors)"), so the exact-name match does not risk
silently picking up a kJ or differently-calculated value. **The real, confirmed defect is narrower:** if a
USDA record has no `"Energy"` entry at all (uncommon but possible, e.g. some incomplete/experimental FDC
records), `extractNutrient(...) ?? 0` silently logs it as 0 kcal/100g with no warning — the same class of
bug as §1.5's OFF zero-calorie case, not a unit-matching ambiguity. Worth adding a presence check (surface
"nutrient data unavailable for this item" rather than defaulting to 0) wherever USDA nutrients are
consumed, including inside whatever replaces this in Option A — but this is data-quality hardening, not a
root cause of mismatched calorie values.

#### 3.4 Recommended fix (design, not yet built)

1. Stand up `CanonicalFood` (+ aliases) as described in 3.2, seeded with a first pass of common
   staples/Egyptian-diet items.
2. Build one shared backend search endpoint (canonical → local items → USDA fallback) used by **both**
   `ManualFoodSearch` and `VoiceLogger`, so an Arabic typed query and an Arabic transcribed query get
   identical results.
3. When a query resolves to exactly one canonical item, show it directly (name + calories/100g) with just
   a grams field — no candidate list — matching the user's ask; keep the existing multi-candidate list
   behavior only for genuine ambiguity (e.g. USDA long-tail fallback, or a canonical entry with real
   preparation-state variants to choose between).
4. Fix the USDA `extractNutrient` missing-nutrient zero-default (3.3) as part of the same work, since
   Option A's fallback path still calls into it.
5. Decide and document the seed list / growth process for the canonical catalog (out of scope to fully
   answer in this doc — needs a product decision, see §4).
6. Apply the new `CanonicalFood` (+ alias) table the same way every other schema change in this project has
   been applied: this repo deliberately has no `Backend/prisma/migrations/` directory — schema changes go
   through `prisma db push` + `prisma generate` (confirmed directly in `AGENTS.md:15` and every existing
   `specs/*/plan.md`). A seed step (populating the initial curated rows) is a separate, additional piece of
   work beyond the schema change itself — a new table with no data is just an empty search index.

**Testing seams:** this is almost entirely backend and unit-testable — the alias-normalization logic
(diacritic/alef-ya handling), the canonical → local-item → USDA fallback ordering, and the
single-vs-multiple-candidate branching in item 3 are all pure-ish service logic that fits the existing
`Backend/test/food/` unit-spec pattern (e.g. alongside `calorie-calculator.spec.ts`) without needing a
running server; the fallback-to-USDA path and the shared endpoint itself belong in an `.e2e-spec.ts`
sibling to `food-logs-edit-delete.e2e-spec.ts`. Only the seed-data *content* (does "chicken breast" really
resolve to a sensible single Egyptian-relevant entry) needs human judgment rather than an assertion.

---

### 4. Decisions needed before implementation / ticket creation

- **Manual search:** confirm Option A (curated bilingual catalog) as the direction, and agree on an
  initial seed-food list (or a process for growing it) before work starts.
- **Manual search:** decide whether making `ManualFoodSearch` also search the user's own `LocalFoodItem`s
  (currently never queried by Manual — §3.2) ships as part of this same round of work, or is deferred —
  it changes search semantics/result ordering and shouldn't be assumed bundled in by default.
- **Scan:** decide the save/edit reuse mechanism (§1.6 item 4) — pass already-resolved nutrients through
  the request payload, vs. a short-lived server-side cache keyed by barcode. These are different designs
  (client-trust vs. cache-invalidation trade-offs) and someone needs to pick one.
- **Voice:** confirm whether transcript-splitting into multiple food terms (business-logic.md's original
  spec) is in scope for this round of work, or explicitly deferred.
- **Voice:** decide whether Arabic is offered as a dedicated voice-input toggle, an account-wide language
  preference, or both.
- Whether to do the manual `ar-EG` dialect-accuracy spot check before or after building the rest of the
  voice changes (the requirements doc calls for doing it *before* building the feature).

### 5. Appendix — unrelated environment finding (not one of the 3 reported problems)

While setting up a live browser repro for the barcode investigation, `npm run start:dev` in `Backend/`
(this sandbox only) compiled cleanly ("Found 0 errors. Watching for file changes.") but the NestJS app
never logged a startup message or accepted connections on port 3000, even after 40+ seconds — both via
the project's own dev-server launcher and running the command directly. Static inspection didn't find an
obvious cause (the Nest bootstrap in `Backend/src/main.ts` is unremarkable, and `nest-cli.json` looks
ordinary). The most likely candidate, per source inspection, is `PrismaService`'s unconditional
`$connect()` during module initialization (`Backend/src/prisma/prisma.service.ts`) stalling before
`app.listen()` can run — e.g. a slow/unreachable first connection to the Neon Postgres instance from this
particular sandbox network. This did not block the diagnosis above (which relied on static code tracing
and direct calls to the real Open Food Facts/USDA APIs instead), and did not reproduce as a problem for
the user in their own environment (they report the manual search and camera already working live) — flagging
it here only in case it's useful context, not as one of the three problems this doc addresses.

A second, unrelated sandbox-only finding: the `USDA_API_KEY` value present in this sandbox's
`Backend/.env` returns `403 API_KEY_INVALID` when queried live against USDA FoodData Central — verifying
§3.3's live claim required falling back to USDA's public `DEMO_KEY` instead. This is almost certainly a
stale/placeholder value specific to this particular checkout, not a real app defect — the user's own
report describes manual search returning live results, which isn't possible without a working key — but
worth a sanity check (`Backend/.env`'s `USDA_API_KEY` against a fresh `curl` call) if manual search or
voice searching is ever seen failing outright with a generic "search failed" message in the real
deployment, since that failure mode is indistinguishable from other USDA outages in the current UI.

### 6. Next steps

This doc is the design/diagnosis artifact requested before opening any GitHub issues. Once the decisions
in §4 are confirmed, the plan is to open one issue per work item (Scan fix, Voice Arabic support, Manual
search redesign + shared bilingual resolver) referencing the relevant sections above.

**Process note, found on re-review:** `AGENTS.md`'s "Feature workflow" section states that new non-trivial
features in this repo follow the spec-kit pattern already used for every existing `specs/NNN-*/` folder
(including `005-manual-food-log-search`, the closest sibling to this work): `spec.md` → `plan.md` →
`tasks.md`, written before implementing, using the `speckit-specify`/`speckit-plan`/`speckit-tasks` skills.
This doc was written as a single `docs/` file per the explicit request that started this work, and stands
on its own for that purpose — but it isn't a replacement for that process, and going straight from this
doc to GitHub issues (skipping `spec.md`/`plan.md`/`tasks.md`) would be a break from how every other
feature in this repo has been built. Worth deciding explicitly: convert §1/§2/§3 above into one or more
proper spec-kit specs (a natural split: Scan fix as one, Voice + Manual's shared bilingual resolver
together as a second, since §2.4 and §3.4 both depend on the same shared search endpoint) before ticket
creation, or consciously accept the lighter-weight path for this particular round of fixes.

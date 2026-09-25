# Lazy portion re-hydration may only fill gaps, never overwrite

Recovering missing package/serving metadata for an already-cached PackagedProduct is done lazily — on the next scan of a product whose locally stored metadata is missing or unusable in a way that leaves the required portion semantics insufficient for safe, useful resolution — rather than by a batch backfill or a staleness window, because it is self-limiting (a product stops being re-fetched as soon as it yields usable metadata) and it preserves the local-first guarantee in `ProductResolverService`, where a local hit currently short-circuits every provider call.

The absence of an optional shortcut is not by itself such a gap. A product with a usable 330 ml Package size and no Serving size still resolves to a complete portion experience — "Whole package (330 ml)" and a custom amount — so it never causes a provider request merely to recover the missing serving; the same holds for a usable Serving size with no Package size. When re-hydration *is* required, a completed check that still yields no usable portion metadata is not repeated for 30 days (a configurable policy), so a product the provider can never complete does not cost a request on every scan. A transient provider failure (timeout, network failure, outage, 5xx) is not a completed check: it leaves the 30-day timestamp and the cached product untouched, and any limit on repeated calls during an outage belongs to a separate short-lived backoff, never to this window (decision register 3.4).

The write it performs is deliberately the narrowest possible one:

- On an `OPEN_FOOD_FACTS` row it may fill portion fields that are missing or unnormalizable, must never replace an existing usable portion value with a different usable one, and must never replace existing usable nutrition values as a side effect of a portion re-hydration.
- A `USER_SUBMITTED` row is never automatically re-hydrated or overwritten. Someone read the physical label, which for an Egyptian product beats Open Food Facts' crowd data; silently replacing it would change the product a user had already been logging.
- A `VERIFIED` row is never automatically overwritten, since `VerificationStatus: VERIFIED` records a deliberate human confirmation that a provider fetch must not be able to contradict or undo.

Refreshing nutrition values is therefore explicitly *not* introduced here. It is a separate concern with its own risks (historical entries' per-100 basis changing under the user) and needs its own decision; letting it ride along with portion recovery would have made this feature the de facto nutrition-refresh policy by accident.

This is the first write-after-create path `packaged_products` has: `upsertFromProvider` is create-or-return-existing today and there is no product PATCH endpoint, so the restrictions above are the whole of the table's mutation policy, not a refinement of an existing one.

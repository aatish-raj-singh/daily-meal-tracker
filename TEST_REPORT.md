# Test Report — Daily Meal Tracker v1.0.0

Generated from automated Vitest runs and fixture workbook inspection on a Windows laptop.

## Fixture workbook inspection (no prior user workbooks found)

No existing personal workbooks were present in the previous workspace. Synthetic fixtures were created:

### `fixtures/nutrition-source.xlsx`

| Sheet | Role | Headers (row 0) |
| --- | --- | --- |
| ReadMe | decoy first sheet | Meta, Value |
| **FoodDB** | nutrition source (non-default) | Item Code, Item Name, Serving Qty, Serving Unit, Energy kcal, Protein (g), Total Carbs, Total Fat, Dietary Fibre, Sugars, Sodium |
| References | unrelated | Reference, URL |

Compatibility: plain values, no macros. Alternate header names exercise column mapping.

### `fixtures/food-log-destination.xlsx`

| Sheet | Role | Notes |
| --- | --- | --- |
| WeeklySummary | unrelated historical sheet | Must remain after FoodLog updates |
| **FoodLog** | destination log | Includes one historical Entry_ID row |

Compatibility concerns (SheetJS community): macros/VBA, charts, pivot tables, data validation, drawings, and some formatting are not guaranteed on round-trip. The app warns on import and keeps a local recovery copy before each destination write.

## Automated results (`npm test`)

**12/12 tests passed** (unit + acceptance).

| # | Criterion | Status | Evidence |
| ---: | --- | --- | --- |
| 1 | Import nutrition source; choose non-default worksheet | **PASS** | Imports `FoodDB` while `ReadMe` is first |
| 2 | Map columns with different header names | **PASS** | Aliases map Item Name / Energy kcal / etc. |
| 3 | Select separate destination workbook + worksheet | **PASS** | `food-log-destination.xlsx` / `FoodLog`; same-hash as source rejected |
| 4 | Log food; verify nutrient calculation | **PASS** | Chicken 200 g → 330 kcal, 62 g protein |
| 5 | Dashboard totals reconcile with entries | **PASS** | `totalsReconcile` OK |
| 6 | Edit entry without duplicate | **PASS** | Same Entry_ID; one destination row |
| 7 | Failed workbook export → local kept, pending | **PASS** | `markSyncFailedForTesting` + pending queue |
| 8 | Retry export → exactly one destination row | **PASS** | `retryPendingWrites` verifies single Entry_ID |
| 9 | Reopen / reload persistence | **PASS** | Reset DB promise and re-read entries/config |
| 10 | Airplane mode / offline local ops | **PARTIAL PASS** | Automated: offline flag + local search/calc. Full UI offline/PWA checked via `npm run build` + service worker generation; manual Safari airplane-mode still recommended |
| 11 | Excel import/export offline with bundled deps | **PASS** | `xlsx` bundled in app chunk; no CDN |
| 12 | Source workbook unchanged | **PASS** | SHA-256 of fixture file unchanged after import |
| 13 | Destination history + unrelated sheets intact | **PASS** | Historical row + `WeeklySummary` preserved |
| 14 | Backup and restore | **PASS** | JSON backup/restore round-trip |
| 15 | Service worker upgrade without deleting IDB | **UNTEST (manual)** | SW registered via `vite-plugin-pwa`; DB name/version stable. Verify on device after redeploy |
| 16 | iPhone Safari + desktop browsers | **UNTEST (manual)** | Desktop: run `npm run preview`. iPhone: deploy HTTPS, Add to Home Screen, import from Files |

## How to re-run

```bash
npm run fixtures
npm test
npm run build
npm run preview
```

## Known limitations

1. SheetJS community edition does not perfectly preserve macros, charts, pivots, validation, or all formatting.
2. iPhone browsers cannot silently overwrite arbitrary Files-app paths; export a timestamped `.xlsx` and save manually.
3. JSON backups restore entries/settings/mappings; Excel binary blobs must be re-imported after clearing site data.
4. Count units with different labels (e.g. `serving` vs `piece`) are not auto-converted.
5. Unknown nutrients stay `null` and are excluded from totals (never invented as zero).
6. Browser IndexedDB can still be cleared by iOS/Safari — keep JSON + Excel exports.

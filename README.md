# Daily Meal Tracker

Local-first, offline-capable meal tracker for laptop and iPhone. Nutrition data comes from a user-selected Excel workbook. Food entries are written to a **separately selected** destination Excel workbook. IndexedDB holds the offline working log, configuration, workbook working copies, and pending sync operations.

**App version:** `1.2.0`

## Login and admin access

Sign-in uses Google. The app does not store a password.

Admin access is granted only when Google verifies the email `biasthakur.aatish@gmail.com`. Every other Google account is a regular user. There is no button that creates an admin password.

Create a Google Cloud OAuth **Web** client and set `VITE_GOOGLE_CLIENT_ID` for local builds and the GitHub Actions build. Authorized JavaScript origins:

- `https://aatish-raj-singh.github.io`
- `http://127.0.0.1:5173`
- `http://localhost:5173`

The client ID is public. It still has to match this app, and the ID token signature is checked against Google's keys.

## Architecture (short)

| Concern | Approach |
| --- | --- |
| Nutrition source | User-picked `.xlsx`, worksheet + column mapping, never modified |
| Destination food log | Independently picked `.xlsx`, append/upsert by stable `Entry_ID` |
| Working / offline store | IndexedDB (`daily-meal-tracker`, schema v1 with migrations-friendly upgrade) |
| Excel library | SheetJS (`xlsx`) **bundled locally** — no CDN |
| Offline shell | Vite PWA service worker caches app assets |
| Durable user export | Timestamped destination `.xlsx` download + JSON backup |

Excel is the user-owned durable food-log format. The browser cannot silently overwrite arbitrary Files-app paths on iPhone; the app updates a local working copy, verifies rows by `Entry_ID`, then exports a clearly named file for you to save.

## Screens

1. **Home / Dashboard** — calorie ring, protein/carbs/fat/fiber bars, meal breakdown, today’s foods  
2. **Log** — search source foods, meal type, quantity/unit, nutrition preview, save with sync status  
3. **History** — day-by-day filter, edit (same Entry_ID), delete with confirmation  
4. **Excel** — independent source & destination import, worksheet selection, column mapping  
5. **Settings** — targets, JSON backup/restore, destination export, storage health, recovery help  

## Develop on a laptop

```bash
npm install
npm run fixtures    # creates fixtures/*.xlsx and public icons
npm run dev         # http://localhost:5173
npm test            # unit + acceptance tests
npm run build       # production build to dist/
npm run preview     # serve dist locally (good for PWA checks)
```

### Manual walkthrough

1. Open **Excel** → import `fixtures/nutrition-source.xlsx` → select worksheet **FoodDB** → save mapping.  
2. Import `fixtures/food-log-destination.xlsx` → worksheet **FoodLog** → save mapping.  
3. **Log** a food (e.g. Chicken Breast, 200 g, lunch). Confirm preview (330 kcal, 62 g protein).  
4. Check **Home** totals.  
5. **History** → edit the entry → confirm no duplicate.  
6. **Settings** → export destination workbook and JSON backup.  
7. DevTools → Network → Offline → reload: search, log, dashboard, backup still work.

## Deploy (GitHub Pages)

Pushes to `main` build the app and publish it with GitHub Actions.

Live site: https://aatish-raj-singh.github.io/daily-meal-tracker/

In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions** if it is not already. Local development stays at `/`. The Pages build uses `/daily-meal-tracker/` so assets resolve on the project site.

Redeploying the app shell does **not** wipe IndexedDB. Database name/version stay stable; schema changes must use the `upgrade` path in `src/db/database.ts`.

## Add to iPhone Home Screen (Safari)

1. Deploy or open the HTTPS URL in Safari.  
2. Share → **Add to Home Screen**.  
3. Launch from the icon (standalone display).  
4. Import both Excel workbooks from Files/iCloud.  
5. After logging, use **Settings → Export destination workbook** and save the timestamped file back to Files.

## Privacy

See [PRIVACY.md](./PRIVACY.md). Never commit personal `.xlsx` files, backups, or exports. Synthetic fixtures under `fixtures/` are safe sample data.

## Tests

```bash
npm test
```

See [TEST_REPORT.md](./TEST_REPORT.md) for acceptance criteria status.

## Known limitations

- SheetJS community round-trip may lose macros, charts, pivots, data validation, drawings, and some formatting.  
- iPhone Safari cannot silently replace an arbitrary existing file; export + manual save is required.  
- JSON backups restore entries/config; re-import Excel binaries after a full site-data clear.  
- Count units (`serving` vs `piece`) are not auto-converted across different labels.  
- Browser storage can still be cleared by the OS — keep exports.

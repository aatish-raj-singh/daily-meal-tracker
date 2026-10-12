# Privacy Statement — Daily Meal Tracker

## What this app stores

Everything stays on your device (browser storage / IndexedDB and files you choose to save):

- Food log entries (date, meal, food, quantity, calculated nutrients, notes, Entry_IDs)
- Nutrition source workbook working copy (imported bytes) and column mapping
- Destination / food-log workbook working copy, recovery copy, and column mapping
- Daily targets and app settings
- Account emails and display names from Google sign-in. Passwords are not stored. A Google ID token is kept in this browser until it expires so the app can confirm the session. Google receives the sign-in itself.
- Pending destination sync operations and recovery metadata
- Optional JSON backups you export yourself

## What is never sent

- This app does **not** upload food records, Excel workbooks, or backups to a remote server.
- There is **no** analytics, advertising, or telemetry that transmits meal data.
- Opening the static site files from GitHub Pages (or another host) only downloads the application shell (HTML/CSS/JS). Your personal data remains in your browser.

## What may be published in the open-source repository

Only application source code, documentation, and **synthetic test fixtures** (sample nutrition/log workbooks with fake data) are published. Do not commit personal workbooks, JSON backups, or exports.

## Browser storage limitations

IndexedDB and Cache Storage can be cleared by:

- You (browser settings / clearing site data)
- iOS / Safari under storage pressure
- Uninstalling the Home Screen app or resetting the device

Use **Settings → Export JSON backup** and **Export destination workbook** regularly.

## Excel round-trip limitations

The bundled SheetJS library may not preserve macros, charts, pivot tables, data validation, drawings, or all formatting when rewriting the destination workbook. Unrelated worksheets are retained in the workbook object when possible; perfect binary preservation is not guaranteed. A recovery copy is stored locally before each destination write.

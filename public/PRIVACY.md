# Privacy Statement — Daily Meal Tracker

## What this app stores

Everything stays on your device (browser storage / IndexedDB and files you choose to save):

- Food log entries (date, meal, food, quantity, calculated nutrients, notes, Entry_IDs)
- Nutrition source workbook working copy (imported bytes) and column mapping
- Destination / food-log workbook working copy, recovery copy, and column mapping
- Daily targets and app settings
- Account emails, display names, approval status, and password hashes (PBKDF2). Passwords are never stored in plain text and are not sent to a server.
- Pending destination sync operations and recovery metadata
- Optional JSON backups you export yourself

## What is never sent

- This app does **not** upload food records, Excel workbooks, or backups to a remote server.
- There is **no** analytics, advertising, or telemetry that transmits meal data.
- Opening the static site files from a host only downloads the application shell (HTML/CSS/JS). Your personal data remains in your browser.

## What may be published in the open-source repository

Only application source code, documentation, and synthetic test fixtures are published. Do not commit personal workbooks, JSON backups, or exports.

## Browser storage limitations

IndexedDB and Cache Storage can be cleared by you, by iOS/Safari under storage pressure, or when clearing site data. Use **Settings → Export JSON backup** and **Export destination workbook** regularly.

## Excel round-trip limitations

The bundled SheetJS library may not preserve macros, charts, pivot tables, data validation, drawings, or all formatting when rewriting the destination workbook. A recovery copy is stored locally before each destination write.

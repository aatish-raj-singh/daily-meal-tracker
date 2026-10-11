import {
  checkStorageHealth,
  getDestinationConfig,
  getPendingWrites,
  getRecovery,
  getSettings,
  saveSettings,
} from '../db/database';
import { downloadJsonBackup, restoreJsonBackup } from '../services/backup';
import {
  exportDestinationWorkbook,
  exportRecoveryCopy,
  retryPendingWrites,
} from '../services/foodLog';
import { APP_VERSION } from '../types';
import { escapeHtml } from '../util/hash';
import { setBanner } from './state';

export async function renderSettings(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const health = await checkStorageHealth();
  const recovery = await getRecovery();
  const pending = await getPendingWrites();
  const dest = await getDestinationConfig();
  const usageMb = health.estimate ? (health.estimate.usage / (1024 * 1024)).toFixed(2) : '—';
  const quotaMb = health.estimate ? (health.estimate.quota / (1024 * 1024)).toFixed(2) : '—';

  root.innerHTML = `
    <div class="card">
      <h2>Daily targets</h2>
      <div class="grid-2">
        <div class="field"><label for="t-cal">Calories</label><input id="t-cal" type="number" min="0" value="${settings.targets.calories}" /></div>
        <div class="field"><label for="t-pro">Protein (g)</label><input id="t-pro" type="number" min="0" value="${settings.targets.protein}" /></div>
        <div class="field"><label for="t-carb">Carbohydrates (g)</label><input id="t-carb" type="number" min="0" value="${settings.targets.carbohydrates}" /></div>
        <div class="field"><label for="t-fat">Fat (g)</label><input id="t-fat" type="number" min="0" value="${settings.targets.fat}" /></div>
        <div class="field"><label for="t-fiber">Fiber (g)</label><input id="t-fiber" type="number" min="0" value="${settings.targets.fiber}" /></div>
      </div>
      <div class="btn-row">
        <button class="primary" id="save-targets">Save targets</button>
      </div>
    </div>

    <div class="card">
      <h2>Excel destination export</h2>
      <p class="muted">Local IndexedDB is the working log. The destination workbook is updated in a working copy and exported as a timestamped .xlsx for you to save.</p>
      <div class="stack-sm muted">
        <div>Destination file: ${escapeHtml(dest?.identity.fileName ?? 'not configured')}</div>
        <div>Pending sync operations: ${pending.length}</div>
        <div>Last verified save: ${escapeHtml(recovery.lastVerifiedSaveAt ?? 'never')}</div>
      </div>
      <div class="btn-row">
        <button class="secondary" id="retry-sync">Retry pending sync</button>
        <button class="primary" id="export-dest">Export destination workbook</button>
        <button class="ghost" id="export-recovery">Download recovery copy</button>
      </div>
    </div>

    <div class="card">
      <h2>JSON backup & restore</h2>
      <p class="muted">Export configuration and food entries as JSON. Workbook binary blobs are not embedded in JSON backups — re-import Excel files after restore if needed.</p>
      <div class="btn-row">
        <button class="secondary" id="backup-json">Export JSON backup</button>
        <label class="secondary" style="display:inline-flex;align-items:center;padding:11px 14px;border-radius:12px;border:1px solid rgba(56,189,248,.35)">
          Restore JSON
          <input id="restore-json" type="file" accept="application/json,.json" class="sr-only" />
        </label>
      </div>
      <p class="muted">Last JSON backup: ${escapeHtml(settings.lastJsonBackupAt ?? 'never')}</p>
    </div>

    <div class="card">
      <h2>Storage health</h2>
      <div class="stack-sm muted">
        <div>App version: <strong>${APP_VERSION}</strong></div>
        <div>IndexedDB: ${health.indexedDbAvailable ? 'available' : 'unavailable'} · health ${health.ok ? 'OK' : 'FAILED'}</div>
        <div>Entries: ${health.entryCount} · Pending writes: ${health.pendingCount}</div>
        <div>Source workbook stored: ${health.hasSource ? 'yes' : 'no'} · Destination working copy: ${health.hasDestination ? 'yes' : 'no'}</div>
        <div>Usage: ${usageMb} MB / Quota: ${quotaMb} MB</div>
        <div>Last successful backup: ${escapeHtml(recovery.lastSuccessfulBackupAt ?? 'never')}</div>
        ${health.error ? `<div class="banner error">${escapeHtml(health.error)}</div>` : ''}
      </div>
      <div class="banner warning" style="margin-top:10px">
        Browser storage (including IndexedDB) can still be cleared by iOS, Safari, or the user. Keep regular JSON and Excel exports. This app never uploads your food records to a server.
      </div>
    </div>

    <div class="card">
      <h2>Privacy</h2>
      <p class="muted">All food logs, workbook working copies, mappings, and targets stay on this device. See <code>PRIVACY.md</code> in the project for the full statement. No analytics telemetry is included.</p>
      <div class="btn-row">
        <a class="secondary" href="./PRIVACY.md" style="text-decoration:none;display:inline-block">Open privacy statement</a>
      </div>
    </div>

    <div class="card">
      <h2>Recovery instructions</h2>
      <ol class="muted" style="padding-left:18px">
        <li>Export JSON backup regularly from this screen.</li>
        <li>Export the destination workbook after logging meals.</li>
        <li>If sync fails, local entries remain; use Retry pending sync, then export again.</li>
        <li>If the working copy is damaged, download the recovery copy created before the last edit.</li>
        <li>After clearing site data, restore JSON and re-import both Excel workbooks.</li>
      </ol>
    </div>
  `;

  root.querySelector('#save-targets')?.addEventListener('click', async () => {
    const s = await getSettings();
    s.targets.calories = Number((root.querySelector('#t-cal') as HTMLInputElement).value);
    s.targets.protein = Number((root.querySelector('#t-pro') as HTMLInputElement).value);
    s.targets.carbohydrates = Number((root.querySelector('#t-carb') as HTMLInputElement).value);
    s.targets.fat = Number((root.querySelector('#t-fat') as HTMLInputElement).value);
    s.targets.fiber = Number((root.querySelector('#t-fiber') as HTMLInputElement).value);
    await saveSettings(s);
    setBanner('success', 'Daily targets saved.');
    window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
  });

  root.querySelector('#backup-json')?.addEventListener('click', async () => {
    try {
      const name = await downloadJsonBackup();
      setBanner('success', `JSON backup downloaded: ${name}`);
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#restore-json')?.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const ok = window.confirm(
      'Restore will replace local settings and food entries from the backup. Continue?',
    );
    if (!ok) return;
    try {
      const text = await file.text();
      const result = await restoreJsonBackup(text, { replaceAll: true });
      setBanner(
        'success',
        `Restored ${result.entryCount} entries. Re-import Excel workbooks if binary copies are needed.`,
      );
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#retry-sync')?.addEventListener('click', async () => {
    try {
      const result = await retryPendingWrites();
      setBanner(
        result.failed ? 'warning' : 'success',
        `Retry complete: ${result.succeeded} succeeded, ${result.failed} failed of ${result.attempted}.`,
      );
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#export-dest')?.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Export the updated destination workbook as a new timestamped .xlsx file? A recovery copy is stored before export. Your original file is never silently overwritten.',
    );
    if (!confirmed) return;
    try {
      const result = await exportDestinationWorkbook();
      setBanner(
        'success',
        `Exported ${result.fileName}. Pending remaining: ${result.pendingRemaining}. Save this file in Files/iCloud manually on iPhone.`,
      );
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#export-recovery')?.addEventListener('click', async () => {
    try {
      const name = await exportRecoveryCopy();
      setBanner('success', `Recovery copy downloaded: ${name}`);
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });
}

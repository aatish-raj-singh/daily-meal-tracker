import { checkStorageHealth, getSettings, saveSettings } from '../db/database';
import { downloadJsonBackup, restoreJsonBackup } from '../services/backup';
import {
  exportDestinationWorkbook,
  exportRecoveryCopy,
  retryPendingWrites,
} from '../services/foodLog';
import { escapeHtml } from '../util/hash';
import { setBanner } from './state';

export async function renderSettings(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const health = await checkStorageHealth();

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
      <h2>Meal log</h2>
      <div class="btn-row">
        <button class="secondary" id="retry-sync">Try saving again</button>
        <button class="primary" id="export-dest">Save meal log</button>
        <button class="ghost" id="export-recovery">Download earlier copy</button>
      </div>
    </div>

    <div class="card">
      <h2>Backup</h2>
      <div class="btn-row">
        <button class="secondary" id="backup-json">Download backup</button>
        <label class="secondary" style="display:inline-flex;align-items:center;padding:11px 14px;border-radius:12px;border:1px solid rgba(56,189,248,.35)">
          Restore backup
          <input id="restore-json" type="file" accept="application/json,.json" class="sr-only" />
        </label>
      </div>
    </div>
    ${health.error ? `<div class="banner error">${escapeHtml(health.error)}</div>` : ''}
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
      setBanner('success', `Backup saved: ${name}`);
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
      'This replaces the meals and settings on this device with the backup. Continue?',
    );
    if (!ok) return;
    try {
      const text = await file.text();
      const result = await restoreJsonBackup(text, { replaceAll: true });
      setBanner(
        'success',
        `Restored ${result.entryCount} meals.`,
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
        result.failed
          ? `${result.succeeded} saved. ${result.failed} still waiting.`
          : 'Meal log saved.',
      );
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#export-dest')?.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Save meals into the meal log file?',
    );
    if (!confirmed) return;
    try {
      const result = await exportDestinationWorkbook();
      setBanner(
        'success',
        result.wroteInPlace ? 'Meal log saved.' : `Downloaded ${result.fileName}.`,
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
      setBanner('success', `Earlier copy saved: ${name}`);
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });
}

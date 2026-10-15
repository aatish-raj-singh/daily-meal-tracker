import {
  getAllAccounts,
  getAllEntries,
  getDestinationConfig,
  getPendingWrites,
  getRecovery,
  getSettings,
  getSourceConfig,
  getWorkoutConfig,
  saveDestinationConfig,
  saveRecovery,
  saveSettings,
  saveSourceConfig,
  saveWorkoutConfig,
  upsertEntry,
  putAccount,
  putPending,
  clearAllData,
} from '../db/database';
import type { JsonBackupPayload } from '../types';
import { APP_VERSION } from '../types';
import { downloadBlob, nowIso } from '../util/hash';

export async function createJsonBackup(): Promise<JsonBackupPayload> {
  const payload: JsonBackupPayload = {
    version: APP_VERSION,
    exportedAt: nowIso(),
    settings: await getSettings(),
    sourceConfig: await getSourceConfig(),
    destinationConfig: await getDestinationConfig(),
    workoutConfig: await getWorkoutConfig(),
    entries: await getAllEntries(true),
    pendingWrites: await getPendingWrites(),
    recovery: await getRecovery(),
    accounts: await getAllAccounts(),
  };
  return payload;
}

export async function downloadJsonBackup(): Promise<string> {
  const payload = await createJsonBackup();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `meal-tracker-backup.${stamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, fileName);

  const settings = await getSettings();
  settings.lastJsonBackupAt = nowIso();
  await saveSettings(settings);

  const recovery = await getRecovery();
  await saveRecovery({
    ...recovery,
    lastSuccessfulBackupAt: settings.lastJsonBackupAt,
  });

  return fileName;
}

export async function restoreJsonBackup(
  text: string,
  options: { replaceAll: boolean } = { replaceAll: true },
): Promise<{ entryCount: number }> {
  let payload: JsonBackupPayload;
  try {
    payload = JSON.parse(text) as JsonBackupPayload;
  } catch {
    throw new Error('Backup file is not valid JSON.');
  }

  if (!payload || !Array.isArray(payload.entries) || !payload.settings) {
    throw new Error('Backup file is missing required fields (settings/entries).');
  }

  if (options.replaceAll) {
    await clearAllData();
  }

  await saveSettings(payload.settings);
  if (payload.sourceConfig) await saveSourceConfig(payload.sourceConfig);
  if (payload.destinationConfig) await saveDestinationConfig(payload.destinationConfig);
  if (payload.workoutConfig) await saveWorkoutConfig(payload.workoutConfig);
  if (payload.recovery) await saveRecovery(payload.recovery);

  for (const entry of payload.entries) {
    if (!entry?.entryId) continue;
    await upsertEntry(entry, null);
  }
  for (const pending of payload.pendingWrites ?? []) {
    if (!pending?.id) continue;
    await putPending(pending);
  }
  for (const account of payload.accounts ?? []) {
    if (!account?.email) continue;
    await putAccount(account);
  }

  return { entryCount: payload.entries.length };
}

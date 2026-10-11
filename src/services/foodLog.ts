import { canViewEntry, getSessionAccount } from '../auth/accounts';
import {
  getBlob,
  getDestinationConfig,
  getEntry,
  getPendingWrites,
  getRecovery,
  getSettings,
  getSourceConfig,
  putBlob,
  putPending,
  removePendingForEntry,
  saveDestinationConfig,
  saveRecovery,
  saveSourceConfig,
  softDeleteEntry,
  upsertEntry,
  getEntriesByDate,
  getAllEntries,
} from '../db/database';
import {
  applyEntryToDestinationWorkbook,
  exportFileName,
  importWorkbookFile,
  loadSourceFoods,
  readWorkbookFromBuffer,
  workbookToBlob,
  buildDefaultDestinationConfig,
  buildDefaultSourceConfig,
  previewSheet,
} from '../excel/workbook';
import { calculateNutrients } from '../nutrition/calc';
import type {
  DestinationWorkbookConfig,
  FoodEntry,
  MealCategory,
  PendingWrite,
  SourceFood,
  SourceWorkbookConfig,
} from '../types';
import { downloadBlob, newId, nowIso, currentTimeLocal, sha256Hex } from '../util/hash';
import { calculateDailyTotals } from './totals';

export interface SaveEntryInput {
  date: string;
  time?: string;
  meal: MealCategory;
  sourceFood: SourceFood;
  quantity: number;
  unit: string;
  notes?: string;
  entryId?: string;
}

export interface SaveEntryResult {
  entry: FoodEntry;
  localSaved: boolean;
  workbookSynced: boolean;
  workbookPending: boolean;
  verified: boolean;
  message: string;
  totals: ReturnType<typeof calculateDailyTotals>;
}

let sourceFoodCache: { sha: string; foods: SourceFood[] } | null = null;

export async function getCachedSourceFoods(): Promise<SourceFood[]> {
  const config = await getSourceConfig();
  const blob = await getBlob('source');
  if (!config || !blob) return [];
  if (sourceFoodCache && sourceFoodCache.sha === blob.sha256) {
    return sourceFoodCache.foods;
  }
  const imported = readWorkbookFromBuffer(blob.data, blob.fileName);
  const foods = loadSourceFoods(imported.workbook, config);
  sourceFoodCache = { sha: blob.sha256, foods };
  return foods;
}

export function invalidateSourceCache(): void {
  sourceFoodCache = null;
}

export async function importSourceWorkbook(
  file: File,
  worksheetName?: string,
  headerRowIndex = 0,
): Promise<{ config: SourceWorkbookConfig; sheetNames: string[]; warnings: string[] }> {
  const imported = await importWorkbookFile(file);
  const sheet = worksheetName ?? imported.sheetNames[0];
  const config = buildDefaultSourceConfig(imported, sheet, headerRowIndex);
  await putBlob({
    id: 'source',
    fileName: imported.identity.fileName,
    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: imported.data,
    sha256: imported.identity.sha256,
    savedAt: nowIso(),
  });
  await saveSourceConfig(config);
  invalidateSourceCache();
  return {
    config,
    sheetNames: imported.sheetNames,
    warnings: imported.warnings.messages,
  };
}

export async function updateSourceMapping(config: SourceWorkbookConfig): Promise<void> {
  await saveSourceConfig(config);
  invalidateSourceCache();
}

export async function importDestinationWorkbook(
  file: File,
  worksheetName?: string,
  headerRowIndex = 0,
): Promise<{ config: DestinationWorkbookConfig; sheetNames: string[]; warnings: string[] }> {
  const imported = await importWorkbookFile(file);
  const source = await getSourceConfig();
  if (source && source.identity.sha256 === imported.identity.sha256) {
    throw new Error(
      'Destination workbook must be selected independently. This file matches the nutrition source workbook hash. Choose a different food-log workbook.',
    );
  }

  const sheet = worksheetName ?? imported.sheetNames[0];
  const config = buildDefaultDestinationConfig(imported, sheet, headerRowIndex);

  // Immutable recovery copy before any edits
  await putBlob({
    id: 'destination-recovery',
    fileName: `RECOVERY_${imported.identity.fileName}`,
    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: imported.data.slice(0),
    sha256: imported.identity.sha256,
    savedAt: nowIso(),
  });

  await putBlob({
    id: 'destination',
    fileName: imported.identity.fileName,
    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: imported.data,
    sha256: imported.identity.sha256,
    savedAt: nowIso(),
  });

  config.lastBackupAt = nowIso();
  await saveDestinationConfig(config);

  return {
    config,
    sheetNames: imported.sheetNames,
    warnings: imported.warnings.messages,
  };
}

export async function updateDestinationMapping(config: DestinationWorkbookConfig): Promise<void> {
  await saveDestinationConfig(config);
}

export async function previewWorkbookSheet(
  kind: 'source' | 'destination',
  sheetName: string,
  headerRowIndex: number,
) {
  const blob = await getBlob(kind);
  if (!blob) throw new Error(`No ${kind} workbook imported.`);
  const imported = readWorkbookFromBuffer(blob.data, blob.fileName);
  return {
    sheetNames: imported.sheetNames,
    preview: previewSheet(imported.workbook, sheetName, headerRowIndex),
    warnings: imported.warnings.messages,
  };
}

export async function saveFoodEntry(input: SaveEntryInput): Promise<SaveEntryResult> {
  const settings = await getSettings();
  const sourceConfig = await getSourceConfig();
  if (!sourceConfig) {
    throw new Error('Import and map a nutrition source workbook before logging food.');
  }

  const calc = calculateNutrients({
    sourceFood: input.sourceFood,
    quantity: input.quantity,
    unit: input.unit,
    caloriesDecimals: settings.rounding.caloriesDecimals,
    macroDecimals: settings.rounding.macroDecimals,
  });
  if (!calc.ok) {
    throw new Error(calc.error ?? 'Unable to calculate nutrition for this quantity/unit.');
  }

  const existing = input.entryId ? await getEntry(input.entryId) : undefined;
  const account = await getSessionAccount();
  if (account && existing && !canViewEntry(existing.ownerEmail, account)) {
    throw new Error('You can only edit your own entries.');
  }
  const entryId = existing?.entryId ?? newId();
  const now = nowIso();

  const entry: FoodEntry = {
    entryId,
    date: input.date,
    time: input.time ?? currentTimeLocal(),
    meal: input.meal,
    sourceFoodId: input.sourceFood.foodId,
    sourceFoodName: input.sourceFood.foodName,
    quantity: input.quantity,
    unit: input.unit,
    basisQuantity: input.sourceFood.basisQuantity,
    basisUnit: input.sourceFood.basisUnit,
    nutrients: calc.nutrients,
    notes: input.notes ?? '',
    sourceWorkbookSha256: sourceConfig.identity.sha256,
    sourceWorksheet: sourceConfig.worksheetName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    syncStatus: 'pending',
    syncError: null,
    deletedAt: null,
    ownerEmail: existing?.ownerEmail ?? account?.email,
  };

  const pending: PendingWrite = {
    id: newId(),
    entryId,
    operation: 'upsert',
    createdAt: now,
    lastAttemptAt: null,
    attemptCount: 0,
    lastError: null,
  };

  await upsertEntry(entry, pending);

  const sync = await trySyncEntry(entry, 'upsert');
  const dayEntries = await getEntriesByDate(entry.date);
  const totals = calculateDailyTotals(entry.date, dayEntries);

  if (sync.synced) {
    return {
      entry: (await getEntry(entryId))!,
      localSaved: true,
      workbookSynced: true,
      workbookPending: false,
      verified: sync.verified,
      message: sync.verified
        ? 'Local log saved and destination workbook updated and verified.'
        : 'Local log saved and workbook written, but verification reported an unexpected row count.',
      totals,
    };
  }

  return {
    entry: (await getEntry(entryId))!,
    localSaved: true,
    workbookSynced: false,
    workbookPending: true,
    verified: false,
    message:
      'Local log is saved, but workbook export/sync is pending. ' +
      (sync.error ?? 'Destination workbook is not ready.'),
    totals,
  };
}

export async function deleteFoodEntry(entryId: string): Promise<SaveEntryResult> {
  const existing = await getEntry(entryId);
  const account = await getSessionAccount();
  if (!existing) throw new Error('Entry not found.');
  if (account && !canViewEntry(existing.ownerEmail, account)) {
    throw new Error('You can only delete your own entries.');
  }
  const pending: PendingWrite = {
    id: newId(),
    entryId,
    operation: 'delete',
    createdAt: nowIso(),
    lastAttemptAt: null,
    attemptCount: 0,
    lastError: null,
  };
  const updated = await softDeleteEntry(entryId, pending);
  if (!updated) throw new Error('Entry not found.');

  const sync = await trySyncEntry(updated, 'delete');
  const dayEntries = await getEntriesByDate(updated.date);
  const totals = calculateDailyTotals(updated.date, dayEntries);

  return {
    entry: (await getEntry(entryId))!,
    localSaved: true,
    workbookSynced: sync.synced,
    workbookPending: !sync.synced,
    verified: sync.verified,
    message: sync.synced
      ? 'Entry deleted locally and removed from destination workbook.'
      : 'Entry deleted locally; workbook sync is pending.',
    totals,
  };
}

async function trySyncEntry(
  entry: FoodEntry,
  operation: 'upsert' | 'delete',
): Promise<{ synced: boolean; verified: boolean; error?: string }> {
  const destConfig = await getDestinationConfig();
  const destBlob = await getBlob('destination');
  if (!destConfig || !destBlob) {
    return {
      synced: false,
      verified: false,
      error: 'No destination workbook configured.',
    };
  }

  try {
    // Recovery snapshot before mutating working copy
    await putBlob({
      id: 'destination-recovery',
      fileName: `RECOVERY_${destBlob.fileName}`,
      mimeType: destBlob.mimeType,
      data: destBlob.data.slice(0),
      sha256: destBlob.sha256,
      savedAt: nowIso(),
    });

    const result = applyEntryToDestinationWorkbook(
      destBlob.data,
      destConfig,
      entry,
      operation,
    );

    if (!result.verified) {
      throw new Error(
        `Verification failed: expected one destination row for Entry_ID, found ${result.rowCountForEntry}.`,
      );
    }

    const sha = await sha256Hex(result.workbookBytes);
    await putBlob({
      id: 'destination',
      fileName: destBlob.fileName,
      mimeType: destBlob.mimeType,
      data: result.workbookBytes,
      sha256: sha,
      savedAt: nowIso(),
    });

    const updatedEntry: FoodEntry = {
      ...entry,
      syncStatus: 'synced',
      syncError: null,
      updatedAt: nowIso(),
    };
    await upsertEntry(updatedEntry, null);
    await removePendingForEntry(entry.entryId);

    const recovery = await getRecovery();
    await saveRecovery({
      ...recovery,
      lastVerifiedSaveAt: nowIso(),
      lastSuccessfulBackupAt: recovery.lastSuccessfulBackupAt ?? nowIso(),
    });

    const cfg = await getDestinationConfig();
    if (cfg) {
      cfg.lastVerifiedExportAt = nowIso();
      cfg.lastBackupAt = nowIso();
      await saveDestinationConfig(cfg);
    }

    return { synced: true, verified: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: FoodEntry = {
      ...entry,
      syncStatus: 'failed',
      syncError: message,
      updatedAt: nowIso(),
    };
    await upsertEntry(failed, null);

    const pendings = await getPendingWrites();
    const existing = pendings.find((p) => p.entryId === entry.entryId);
    await putPending({
      id: existing?.id ?? newId(),
      entryId: entry.entryId,
      operation,
      createdAt: existing?.createdAt ?? nowIso(),
      lastAttemptAt: nowIso(),
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      lastError: message,
    });

    return { synced: false, verified: false, error: message };
  }
}

export async function retryPendingWrites(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  messages: string[];
}> {
  const pending = await getPendingWrites();
  let succeeded = 0;
  let failed = 0;
  const messages: string[] = [];

  for (const item of pending) {
    const entry = await getEntry(item.entryId);
    if (!entry) {
      await removePendingForEntry(item.entryId);
      continue;
    }
    const op = entry.deletedAt ? 'delete' : item.operation;
    const result = await trySyncEntry(entry, op);
    if (result.synced) {
      succeeded += 1;
      messages.push(`Synced ${entry.entryId}`);
    } else {
      failed += 1;
      messages.push(`Failed ${entry.entryId}: ${result.error}`);
    }
  }

  return { attempted: pending.length, succeeded, failed, messages };
}

export async function exportDestinationWorkbook(): Promise<{
  fileName: string;
  pendingRemaining: number;
}> {
  const blob = await getBlob('destination');
  const config = await getDestinationConfig();
  if (!blob || !config) {
    throw new Error('No destination workbook working copy available.');
  }

  // Refresh recovery copy before user download
  await putBlob({
    id: 'destination-recovery',
    fileName: `RECOVERY_${blob.fileName}`,
    mimeType: blob.mimeType,
    data: blob.data.slice(0),
    sha256: blob.sha256,
    savedAt: nowIso(),
  });

  const retry = await retryPendingWrites();
  const fresh = await getBlob('destination');
  if (!fresh) throw new Error('Destination working copy missing after sync retry.');

  const fileName = exportFileName(config.identity.fileName, 'export');
  downloadBlob(workbookToBlob(fresh.data), fileName);

  config.lastVerifiedExportAt = nowIso();
  config.lastBackupAt = nowIso();
  await saveDestinationConfig(config);

  const pendingRemaining = (await getPendingWrites()).length;
  if (retry.failed > 0) {
    throw new Error(
      `Exported ${fileName}, but ${retry.failed} pending sync operation(s) still failed. Local records remain; retry again later.`,
    );
  }

  return { fileName, pendingRemaining };
}

export async function exportRecoveryCopy(): Promise<string> {
  const recovery = await getBlob('destination-recovery');
  if (!recovery) throw new Error('No recovery copy available.');
  const fileName = exportFileName(recovery.fileName.replace(/^RECOVERY_/, ''), 'backup');
  downloadBlob(workbookToBlob(recovery.data), fileName);
  return fileName;
}

export async function getDashboardData(date: string) {
  const account = await getSessionAccount();
  const entries = (await getEntriesByDate(date)).filter((entry) =>
    account ? canViewEntry(entry.ownerEmail, account) : true,
  );
  const settings = await getSettings();
  const totals = calculateDailyTotals(date, entries);
  const pending = await getPendingWrites();
  return { entries, settings, totals, pendingCount: pending.length };
}

export async function listHistory(filters: {
  dateFrom?: string;
  dateTo?: string;
  meal?: MealCategory | 'all';
}): Promise<FoodEntry[]> {
  const account = await getSessionAccount();
  const all = (await getAllEntries(false)).filter((entry) =>
    account ? canViewEntry(entry.ownerEmail, account) : true,
  );
  return all
    .filter((e) => {
      if (filters.dateFrom && e.date < filters.dateFrom) return false;
      if (filters.dateTo && e.date > filters.dateTo) return false;
      if (filters.meal && filters.meal !== 'all' && e.meal !== filters.meal) return false;
      return true;
    })
    .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
}

/** Simulate a failed export for acceptance tests. */
export async function markSyncFailedForTesting(entryId: string, error: string): Promise<void> {
  const entry = await getEntry(entryId);
  if (!entry) throw new Error('Entry not found');
  const failed = { ...entry, syncStatus: 'failed' as const, syncError: error };
  const pending: PendingWrite = {
    id: newId(),
    entryId,
    operation: 'upsert',
    createdAt: nowIso(),
    lastAttemptAt: nowIso(),
    attemptCount: 1,
    lastError: error,
  };
  await upsertEntry(failed, pending);
}

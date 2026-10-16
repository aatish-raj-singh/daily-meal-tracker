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
  putEntriesAtomic,
} from '../db/database';
import {
  appendNutritionRow,
  applyEntryToDestinationWorkbook,
  exportFileName,
  importWorkbookFile,
  loadSourceFoods,
  readWorkbookFromBuffer,
  workbookToBlob,
  buildDefaultDestinationConfig,
  buildDefaultSourceConfig,
  previewSheet,
  type NutritionSheetRow,
} from '../excel/workbook';
import { calculateNutrients } from '../nutrition/calc';
import type {
  DestinationWorkbookConfig,
  FoodEntry,
  MealCategory,
  NutrientValues,
  PendingWrite,
  SourceFood,
  SourceWorkbookConfig,
} from '../types';
import { refreshBoundFile, updateBoundFile, writeBoundFile } from '../excel/fileAccess';
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
  if (await refreshBoundFile('source').catch(() => false)) invalidateSourceCache();
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

export async function addNutritionFood(
  row: Omit<NutritionSheetRow, 'foodId'>,
): Promise<void> {
  const config = await getSourceConfig();
  const blob = await getBlob('source');
  if (!config || !blob) throw new Error('Add your food list first.');
  const fullRow = { ...row, foodId: newId() };
  const written = await updateBoundFile('source', (data) => appendNutritionRow(data, config, fullRow));
  const bytes = written ?? appendNutritionRow(blob.data, config, fullRow);
  const sha = await sha256Hex(bytes);
  await putBlob({
    id: 'source',
    fileName: blob.fileName,
    mimeType: blob.mimeType,
    data: bytes,
    sha256: sha,
    savedAt: nowIso(),
  });
  invalidateSourceCache();
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
      'That file is already your food list. Choose a different Excel file for meals.',
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

function missingWorkbookMessage(kind: 'source' | 'destination' | 'workout'): string {
  switch (kind) {
    case 'source':
      return 'Add your food list first.';
    case 'destination':
      return 'Add a meal log file first.';
    case 'workout':
      return 'Add a workout plan first.';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export async function previewWorkbookSheet(
  kind: 'source' | 'destination' | 'workout',
  sheetName: string,
  headerRowIndex: number,
) {
  const blob = await getBlob(kind);
  if (!blob) throw new Error(missingWorkbookMessage(kind));
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
    throw new Error('Add your food list on the Excel tab first.');
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
        ? 'Meal saved.'
        : 'Meal saved. Download the Excel file from Settings and check the latest row.',
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
      'Meal saved on this device. ' +
      (sync.error ?? 'The Excel meal log is not ready yet.'),
    totals,
  };
}

export interface CopyEntryDraft {
  entryId: string;
  sourceEntryId: string | null;
  date: string;
  time: string;
  meal: MealCategory;
  sourceFoodId: string;
  sourceFoodName: string;
  quantity: number;
  unit: string;
  basisQuantity: number;
  basisUnit: string;
  nutrients: NutrientValues;
  notes: string;
  sourceWorkbookSha256: string;
  sourceWorksheet: string;
}

export interface CopyMealResult {
  count: number;
  date: string;
  meal: MealCategory;
  workbookSynced: boolean;
  message: string;
}

let copyBusy = false;
let copyFlight: Promise<CopyMealResult> | null = null;

export function saveCopiedEntries(drafts: CopyEntryDraft[]): Promise<CopyMealResult> {
  if (copyBusy && copyFlight) return copyFlight;
  copyBusy = true;
  copyFlight = persistCopiedEntries(drafts).finally(() => {
    copyBusy = false;
    copyFlight = null;
  });
  return copyFlight;
}

async function persistCopiedEntries(drafts: CopyEntryDraft[]): Promise<CopyMealResult> {
  if (drafts.length === 0) throw new Error('Add at least one food.');
  const date = drafts[0]?.date ?? '';
  const meal = drafts[0]?.meal;
  if (!meal || drafts.some((draft) => draft.date !== date || draft.meal !== meal)) {
    throw new Error('Copy one meal at a time.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid date.');
  const ids = new Set<string>();
  for (const draft of drafts) {
    if (!(draft.quantity > 0)) throw new Error(`Enter a weight for ${draft.sourceFoodName}.`);
    if (!draft.entryId || ids.has(draft.entryId)) throw new Error('Couldn’t copy this meal. Try again.');
    ids.add(draft.entryId);
    if (draft.sourceEntryId && draft.entryId === draft.sourceEntryId) {
      throw new Error('Couldn’t copy this meal. Try again.');
    }
    const existing = await getEntry(draft.entryId);
    if (existing && existing.sourceFoodId !== draft.sourceFoodId) {
      throw new Error('This copy was already saved.');
    }
  }

  const account = await getSessionAccount();
  const now = nowIso();
  const rows: Array<{ entry: FoodEntry; pending: PendingWrite }> = [];
  for (const draft of drafts) {
    const existing = await getEntry(draft.entryId);
    const entry: FoodEntry = {
      entryId: draft.entryId,
      date: draft.date,
      time: draft.time || currentTimeLocal(),
      meal: draft.meal,
      sourceFoodId: draft.sourceFoodId,
      sourceFoodName: draft.sourceFoodName,
      quantity: draft.quantity,
      unit: draft.unit,
      basisQuantity: draft.basisQuantity,
      basisUnit: draft.basisUnit,
      nutrients: { ...draft.nutrients },
      notes: draft.notes,
      sourceWorkbookSha256: draft.sourceWorkbookSha256,
      sourceWorksheet: draft.sourceWorksheet,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      syncStatus: 'pending',
      syncError: null,
      deletedAt: null,
      ownerEmail: existing?.ownerEmail ?? account?.email,
    };
    rows.push({
      entry,
      pending: {
        id: newId(),
        entryId: entry.entryId,
        operation: 'upsert',
        createdAt: now,
        lastAttemptAt: null,
        attemptCount: 0,
        lastError: null,
      },
    });
  }

  await putEntriesAtomic(rows);

  let workbookSynced = true;
  let syncError = '';
  for (const row of rows) {
    const sync = await trySyncEntry(row.entry, 'upsert');
    if (!sync.synced) {
      workbookSynced = false;
      syncError = sync.error ?? '';
    }
  }

  const count = rows.length;
  const noun = count === 1 ? 'food' : 'foods';
  const saved = `Copied ${count} ${noun}.`;
  return {
    count,
    date,
    meal,
    workbookSynced,
    message: workbookSynced
      ? saved
      : `${saved} Saved on this device. ${syncError || 'The Excel meal log is not ready yet.'}`,
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
      ? 'Meal removed.'
      : 'Meal removed on this device. The Excel file still needs updating.',
    totals,
  };
}

async function trySyncEntry(
  entry: FoodEntry,
  operation: 'upsert' | 'delete',
): Promise<{ synced: boolean; verified: boolean; error?: string }> {
  await refreshBoundFile('destination');
  const destConfig = await getDestinationConfig();
  const destBlob = await getBlob('destination');
  if (!destConfig || !destBlob) {
    return {
      synced: false,
      verified: false,
      error: 'Add a meal log file on the Excel tab first.',
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
        'The meal couldn’t be checked in the Excel file. Try saving again.',
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
    await writeBoundFile('destination', result.workbookBytes);

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
  wroteInPlace: boolean;
}> {
  const blob = await getBlob('destination');
  const config = await getDestinationConfig();
  if (!blob || !config) {
    throw new Error('Add a meal log file on the Excel tab first.');
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
  if (!fresh) throw new Error('The meal log isn’t ready to download. Try again.');

  const fileName = exportFileName(config.identity.fileName, 'export');
  const wroteInPlace = await writeBoundFile('destination', fresh.data);
  if (!wroteInPlace) downloadBlob(workbookToBlob(fresh.data), fileName);

  config.lastVerifiedExportAt = nowIso();
  config.lastBackupAt = nowIso();
  await saveDestinationConfig(config);

  const pendingRemaining = (await getPendingWrites()).length;
  if (retry.failed > 0) {
    throw new Error(
      wroteInPlace
        ? `${retry.failed} meal${retry.failed === 1 ? '' : 's'} still need saving.`
        : `Downloaded ${fileName}, but ${retry.failed} meal${retry.failed === 1 ? '' : 's'} still need saving.`,
    );
  }

  return { fileName, pendingRemaining, wroteInPlace };
}

export async function exportRecoveryCopy(): Promise<string> {
  const recovery = await getBlob('destination-recovery');
  if (!recovery) throw new Error('No earlier copy to download yet.');
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

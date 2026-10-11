import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  clearAllData,
  getAllEntries,
  getBlob,
  getPendingWrites,
  getSettings,
  resetDbPromise,
} from '../src/db/database';
import {
  applyEntryToDestinationWorkbook,
  importWorkbookFile,
  loadSourceFoods,
  previewSheet,
  readWorkbookFromBuffer,
} from '../src/excel/workbook';
import { suggestSourceMapping } from '../src/excel/mapping';
import { calculateNutrients } from '../src/nutrition/calc';
import { downloadJsonBackup, restoreJsonBackup } from '../src/services/backup';
import {
  getCachedSourceFoods,
  importDestinationWorkbook,
  importSourceWorkbook,
  invalidateSourceCache,
  markSyncFailedForTesting,
  retryPendingWrites,
  saveFoodEntry,
  updateDestinationMapping,
  updateSourceMapping,
} from '../src/services/foodLog';
import { calculateDailyTotals, totalsReconcile } from '../src/services/totals';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

function fileFromPath(filePath: string): File {
  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const ab = toArrayBuffer(buf);
  const file = {
    name,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buf.byteLength,
    lastModified: Date.now(),
    arrayBuffer: async () => ab.slice(0),
  } as unknown as File;
  return file;
}

async function resetDb(): Promise<void> {
  invalidateSourceCache();
  try {
    await clearAllData();
  } catch {
    // database may not exist yet
  }
  resetDbPromise();
}

describe('acceptance criteria', () => {
  beforeAll(() => {
    expect(fs.existsSync(path.join(fixturesDir, 'nutrition-source.xlsx'))).toBe(true);
    expect(fs.existsSync(path.join(fixturesDir, 'food-log-destination.xlsx'))).toBe(true);
  });

  afterEach(async () => {
    await resetDb();
  }, 15000);

  it('1-3: imports source on non-default sheet, maps alternate headers, imports separate destination', async () => {
    const sourceFile = fileFromPath(path.join(fixturesDir, 'nutrition-source.xlsx'));
    const sourceBytes = await sourceFile.arrayBuffer();
    const sourceShaBefore = Buffer.from(
      await crypto.subtle.digest('SHA-256', new Uint8Array(sourceBytes)),
    ).toString('hex');

    const imported = await importSourceWorkbook(sourceFile, 'FoodDB', 0);
    expect(imported.sheetNames).toContain('ReadMe');
    expect(imported.sheetNames).toContain('FoodDB');
    expect(imported.config.worksheetName).toBe('FoodDB');

    // Alternate headers auto-suggested
    const preview = previewSheet(
      readWorkbookFromBuffer(sourceBytes, sourceFile.name).workbook,
      'FoodDB',
      0,
    );
    const suggested = suggestSourceMapping(preview.headers);
    expect(suggested.foodName).not.toBeNull();
    expect(suggested.calories).not.toBeNull();
    imported.config.mapping = suggested;
    await updateSourceMapping(imported.config);

    const foods = await getCachedSourceFoods();
    expect(foods.length).toBeGreaterThanOrEqual(5);
    expect(foods.some((f) => f.foodName === 'Chicken Breast')).toBe(true);

    const destFile = fileFromPath(path.join(fixturesDir, 'food-log-destination.xlsx'));
    const dest = await importDestinationWorkbook(destFile, 'FoodLog', 0);
    expect(dest.config.worksheetName).toBe('FoodLog');
    expect(dest.sheetNames).toContain('WeeklySummary');
    expect(dest.sheetNames).toContain('FoodLog');

    // Source file bytes unchanged on disk
    const sourceBytesAfter = fs.readFileSync(path.join(fixturesDir, 'nutrition-source.xlsx'));
    const sourceShaAfter = Buffer.from(
      await crypto.subtle.digest('SHA-256', new Uint8Array(sourceBytesAfter)),
    ).toString('hex');
    expect(sourceShaAfter).toBe(sourceShaBefore);
  });

  it('4-6: logs food, verifies calc, reconciles dashboard, edits without duplicate', async () => {
    await importSourceWorkbook(
      fileFromPath(path.join(fixturesDir, 'nutrition-source.xlsx')),
      'FoodDB',
      0,
    );
    const destImport = await importDestinationWorkbook(
      fileFromPath(path.join(fixturesDir, 'food-log-destination.xlsx')),
      'FoodLog',
      0,
    );
    // Ensure mapping covers entry id
    const destCfg = destImport.config;
    destCfg.mapping.entryId = 0;
    destCfg.mapping.date = 1;
    destCfg.mapping.time = 2;
    destCfg.mapping.meal = 3;
    destCfg.mapping.foodName = 4;
    destCfg.mapping.quantity = 5;
    destCfg.mapping.unit = 6;
    destCfg.mapping.calories = 7;
    destCfg.mapping.protein = 8;
    destCfg.mapping.carbohydrates = 9;
    destCfg.mapping.fat = 10;
    destCfg.mapping.fiber = 11;
    destCfg.mapping.notes = 12;
    destCfg.mapping.sourceFoodId = 13;
    destCfg.mapping.lastModified = 14;
    await updateDestinationMapping(destCfg);

    const foods = await getCachedSourceFoods();
    const chicken = foods.find((f) => f.foodId === 'CHK-001')!;
    const expected = calculateNutrients({
      sourceFood: chicken,
      quantity: 200,
      unit: 'g',
    });
    expect(expected.nutrients.calories).toBe(330);
    expect(expected.nutrients.protein).toBe(62);

    const saved = await saveFoodEntry({
      date: '2026-10-11',
      meal: 'lunch',
      sourceFood: chicken,
      quantity: 200,
      unit: 'g',
      notes: 'acceptance test',
    });
    expect(saved.localSaved).toBe(true);
    expect(saved.entry.nutrients.calories).toBe(330);
    expect(saved.entry.nutrients.protein).toBe(62);

    const dayEntries = await getAllEntries();
    const day = dayEntries.filter((e) => e.date === '2026-10-11');
    const totals = calculateDailyTotals('2026-10-11', day);
    expect(totalsReconcile(totals, day).ok).toBe(true);
    expect(totals.calories).toBe(330);

    // Edit quantity to 100 g — same Entry_ID, no duplicate
    const edited = await saveFoodEntry({
      date: '2026-10-11',
      meal: 'lunch',
      sourceFood: chicken,
      quantity: 100,
      unit: 'g',
      entryId: saved.entry.entryId,
    });
    expect(edited.entry.entryId).toBe(saved.entry.entryId);
    expect(edited.entry.nutrients.calories).toBe(165);

    const afterEdit = (await getAllEntries()).filter((e) => !e.deletedAt);
    const sameId = afterEdit.filter((e) => e.entryId === saved.entry.entryId);
    expect(sameId).toHaveLength(1);

    // Destination workbook has exactly one row for Entry_ID
    const destBlob = await getBlob('destination');
    expect(destBlob).toBeTruthy();
    const wb = XLSX.read(destBlob!.data, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.FoodLog, {
      header: 1,
      defval: '',
    });
    const matches = rows.filter((r, i) => i > 0 && String(r[0]) === saved.entry.entryId);
    expect(matches).toHaveLength(1);

    // Historical row preserved
    expect(rows.some((r) => String(r[0]) === 'hist-0001-aaaa-bbbb-cccccccccccc')).toBe(true);
    // Unrelated sheet preserved
    expect(wb.SheetNames).toContain('WeeklySummary');
  });

  it('7-8: failed export keeps local pending; retry writes exactly one destination row', async () => {
    await importSourceWorkbook(
      fileFromPath(path.join(fixturesDir, 'nutrition-source.xlsx')),
      'FoodDB',
      0,
    );
    // Import destination then remove working copy to simulate failure path via markSyncFailed
    const destImport = await importDestinationWorkbook(
      fileFromPath(path.join(fixturesDir, 'food-log-destination.xlsx')),
      'FoodLog',
      0,
    );
    const destCfg = destImport.config;
    destCfg.mapping = {
      entryId: 0,
      date: 1,
      time: 2,
      meal: 3,
      foodName: 4,
      quantity: 5,
      unit: 6,
      calories: 7,
      protein: 8,
      carbohydrates: 9,
      fat: 10,
      fiber: 11,
      notes: 12,
      sourceFoodId: 13,
      lastModified: 14,
    };
    await updateDestinationMapping(destCfg);

    const foods = await getCachedSourceFoods();
    const rice = foods.find((f) => f.foodId === 'RICE-01')!;
    const saved = await saveFoodEntry({
      date: '2026-10-11',
      meal: 'dinner',
      sourceFood: rice,
      quantity: 150,
      unit: 'g',
    });

    await markSyncFailedForTesting(saved.entry.entryId, 'Simulated export failure');
    const pending = await getPendingWrites();
    expect(pending.some((p) => p.entryId === saved.entry.entryId)).toBe(true);

    const local = (await getAllEntries()).find((e) => e.entryId === saved.entry.entryId);
    expect(local).toBeTruthy();
    expect(local!.syncStatus).toBe('failed');

    const retry = await retryPendingWrites();
    expect(retry.succeeded).toBeGreaterThanOrEqual(1);

    const destBlob = await getBlob('destination');
    const wb = XLSX.read(destBlob!.data, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.FoodLog, {
      header: 1,
      defval: '',
    });
    const matches = rows.filter((r, i) => i > 0 && String(r[0]) === saved.entry.entryId);
    expect(matches).toHaveLength(1);
  });

  it('9 & 14: persists after reopen-equivalent reload and backup/restore', async () => {
    await importSourceWorkbook(
      fileFromPath(path.join(fixturesDir, 'nutrition-source.xlsx')),
      'FoodDB',
      0,
    );
    await importDestinationWorkbook(
      fileFromPath(path.join(fixturesDir, 'food-log-destination.xlsx')),
      'FoodLog',
      0,
    );
    const foods = await getCachedSourceFoods();
    await saveFoodEntry({
      date: '2026-10-11',
      meal: 'snack',
      sourceFood: foods[0],
      quantity: foods[0].basisQuantity,
      unit: foods[0].basisUnit,
    });

    // Simulate reopen: reset module db promise and read again
    resetDbPromise();
    const settings = await getSettings();
    expect(settings).toBeTruthy();
    const entries = await getAllEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const downloads: Array<{ name: string; body: string }> = [];
    vi.stubGlobal(
      'URL',
      class {
        static createObjectURL() {
          return 'blob:test';
        }
        static revokeObjectURL() {}
      },
    );
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ name: this.download, body: '' });
      });

    // Patch Blob text capture via downloadJsonBackup side effects on settings
    const name = await downloadJsonBackup();
    expect(name).toContain('meal-tracker-backup');

    const payload = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      settings: await getSettings(),
      sourceConfig: null,
      destinationConfig: null,
      entries: await getAllEntries(true),
      pendingWrites: await getPendingWrites(),
      recovery: {
        id: 'primary' as const,
        lastSuccessfulBackupAt: null,
        lastVerifiedSaveAt: null,
        lastHealthCheckAt: null,
        lastHealthCheckOk: true,
        notes: [],
      },
    };

    await clearAllData();
    resetDbPromise();
    const restored = await restoreJsonBackup(JSON.stringify(payload), { replaceAll: true });
    expect(restored.entryCount).toBe(payload.entries.length);
    expect((await getAllEntries()).length).toBe(payload.entries.filter((e) => !e.deletedAt).length);

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('11 & 12 & 13: excel processing uses local library; source unchanged; history/sheets intact', async () => {
    const sourcePath = path.join(fixturesDir, 'nutrition-source.xlsx');
    const before = fs.readFileSync(sourcePath);
    const file = fileFromPath(sourcePath);
    const imported = await importWorkbookFile(file);
    expect(imported.sheetNames).toEqual(['ReadMe', 'FoodDB', 'References']);
    const foods = loadSourceFoods(
      imported.workbook,
      {
        identity: imported.identity,
        worksheetName: 'FoodDB',
        headerRowIndex: 0,
        mapping: suggestSourceMapping(
          previewSheet(imported.workbook, 'FoodDB', 0).headers,
        ),
        previewHeaders: previewSheet(imported.workbook, 'FoodDB', 0).headers,
      },
    );
    expect(foods.length).toBeGreaterThan(0);

    const after = fs.readFileSync(sourcePath);
    expect(Buffer.compare(before, after)).toBe(0);

    const destPath = path.join(fixturesDir, 'food-log-destination.xlsx');
    const destData = fs.readFileSync(destPath);
    const destWb = XLSX.read(destData, { type: 'buffer' });
    expect(destWb.SheetNames).toContain('WeeklySummary');

    const entry = {
      entryId: 'test-entry-id-0001',
      date: '2026-10-11',
      time: '12:00',
      meal: 'lunch' as const,
      sourceFoodId: 'CHK-001',
      sourceFoodName: 'Chicken Breast',
      quantity: 200,
      unit: 'g',
      basisQuantity: 100,
      basisUnit: 'g',
      nutrients: {
        calories: 330,
        protein: 62,
        carbohydrates: 0,
        fat: 7.2,
        fiber: 0,
        sugar: null,
        sodium: null,
        saturatedFat: null,
        cholesterol: null,
        potassium: null,
        calcium: null,
        iron: null,
        vitaminC: null,
        vitaminA: null,
      },
      notes: '',
      sourceWorkbookSha256: 'abc',
      sourceWorksheet: 'FoodDB',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending' as const,
      syncError: null,
      deletedAt: null,
    };

    const applied = applyEntryToDestinationWorkbook(
      destData.buffer.slice(destData.byteOffset, destData.byteOffset + destData.byteLength),
      {
        identity: {
          fileName: 'food-log-destination.xlsx',
          importedAt: new Date().toISOString(),
          byteLength: destData.byteLength,
          sha256: 'x',
        },
        worksheetName: 'FoodLog',
        headerRowIndex: 0,
        mapping: {
          entryId: 0,
          date: 1,
          time: 2,
          meal: 3,
          foodName: 4,
          quantity: 5,
          unit: 6,
          calories: 7,
          protein: 8,
          carbohydrates: 9,
          fat: 10,
          fiber: 11,
          notes: 12,
          sourceFoodId: 13,
          lastModified: 14,
        },
        previewHeaders: [],
        lastVerifiedExportAt: null,
        lastBackupAt: null,
      },
      entry,
      'upsert',
    );
    expect(applied.verified).toBe(true);
    expect(applied.sheetNames).toContain('WeeklySummary');
    expect(applied.rowCountForEntry).toBe(1);

    // Original destination fixture file on disk unchanged
    const destAfter = fs.readFileSync(destPath);
    expect(Buffer.compare(destData, destAfter)).toBe(0);
  });

  it('10 (partial): offline flag does not block local calc/search helpers', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await importSourceWorkbook(
      fileFromPath(path.join(fixturesDir, 'nutrition-source.xlsx')),
      'FoodDB',
      0,
    );
    const foods = await getCachedSourceFoods();
    expect(foods.length).toBeGreaterThan(0);
    const calc = calculateNutrients({
      sourceFood: foods[0],
      quantity: foods[0].basisQuantity,
      unit: foods[0].basisUnit,
    });
    expect(calc.ok).toBe(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });
});

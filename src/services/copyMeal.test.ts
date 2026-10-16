import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllData,
  getAllEntries,
  getBlob,
  getEntry,
  getPendingWrites,
  resetDbPromise,
  upsertEntry,
} from '../db/database';
import type { FoodEntry, NutrientValues, SourceFood } from '../types';
import { calculateDailyTotals } from './totals';
import {
  copyLineFromEntry,
  draftFromLine,
  lineNutrients,
  shiftLocalDate,
  yesterdayLocal,
} from './copyMeal';
import { importDestinationWorkbook, saveCopiedEntries, type CopyEntryDraft } from './foodLog';

const nutrients = (calories: number, protein: number): NutrientValues => ({
  calories,
  protein,
  carbohydrates: 0,
  fat: 3.6,
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
});

function entry(partial: Partial<FoodEntry> & Pick<FoodEntry, 'entryId' | 'date' | 'meal'>): FoodEntry {
  return {
    entryId: partial.entryId,
    date: partial.date,
    time: partial.time ?? '08:00',
    meal: partial.meal,
    sourceFoodId: partial.sourceFoodId ?? 'chicken',
    sourceFoodName: partial.sourceFoodName ?? 'Chicken Breast',
    quantity: partial.quantity ?? 100,
    unit: partial.unit ?? 'g',
    basisQuantity: partial.basisQuantity ?? 100,
    basisUnit: partial.basisUnit ?? 'g',
    nutrients: partial.nutrients ?? nutrients(165, 31),
    notes: partial.notes ?? 'leftover',
    sourceWorkbookSha256: partial.sourceWorkbookSha256 ?? 'sha',
    sourceWorksheet: partial.sourceWorksheet ?? 'Foods',
    createdAt: partial.createdAt ?? '2026-10-15T08:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-10-15T08:00:00.000Z',
    syncStatus: partial.syncStatus ?? 'synced',
    syncError: null,
    deletedAt: null,
    ownerEmail: partial.ownerEmail,
  };
}

function catalogueFood(): SourceFood {
  return {
    foodId: 'chicken',
    foodName: 'Chicken Breast',
    basisQuantity: 100,
    basisUnit: 'g',
    nutrients: nutrients(165, 31),
    rowIndex: 2,
    sourceWorksheet: 'Foods',
    sourceFileName: 'nutrition.xlsx',
  };
}

function draftFor(source: FoodEntry, entryId: string, date: string, quantity = source.quantity): CopyEntryDraft {
  const line = copyLineFromEntry(source, [catalogueFood()]);
  line.entryId = entryId;
  line.quantity = quantity;
  const nutrition = lineNutrients(line, [catalogueFood()], { caloriesDecimals: 0, macroDecimals: 1 });
  return draftFromLine(line, date, source.meal, nutrition.nutrients);
}

async function reset(): Promise<void> {
  try {
    await clearAllData();
  } catch {
    // first run
  }
  resetDbPromise();
}

describe('copy previous meal', () => {
  beforeEach(async () => {
    await reset();
  });

  it('uses the local calendar day before today', () => {
    expect(shiftLocalDate('2026-10-16', -1)).toBe('2026-10-15');
    expect(shiftLocalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(yesterdayLocal('2026-01-01')).toBe('2025-12-31');
  });

  it('keeps saved nutrition until the quantity changes', () => {
    const source = entry({ entryId: 'source', date: '2026-10-15', meal: 'breakfast' });
    const line = copyLineFromEntry(source, [catalogueFood()]);
    const same = lineNutrients(line, [catalogueFood()], { caloriesDecimals: 0, macroDecimals: 1 });
    expect(same.nutrients.calories).toBe(165);
    expect(same.review).toBe(false);

    line.quantity = 200;
    const doubled = lineNutrients(line, [catalogueFood()], { caloriesDecimals: 0, macroDecimals: 1 });
    expect(doubled.nutrients.calories).toBe(330);
    expect(doubled.nutrients.protein).toBe(62);
  });

  it('scales an unresolved food from the saved entry and flags it', () => {
    const source = entry({ entryId: 'manual', date: '2026-10-15', meal: 'lunch', sourceFoodId: 'missing' });
    const line = copyLineFromEntry(source, []);
    expect(line.unresolved).toBe(true);
    const same = lineNutrients(line, [], { caloriesDecimals: 0, macroDecimals: 1 });
    expect(same.nutrients).toEqual(source.nutrients);
    expect(same.review).toBe(true);

    line.quantity = 50;
    const halved = lineNutrients(line, [], { caloriesDecimals: 0, macroDecimals: 1 });
    expect(halved.nutrients.calories).toBe(83);
    expect(halved.review).toBe(true);
  });

  it('copies several foods onto a day that already has meals without changing the source', async () => {
    const breakfast = entry({ entryId: 'b1', date: '2026-10-15', meal: 'breakfast', time: '08:00' });
    const oats = entry({
      entryId: 'b2',
      date: '2026-10-15',
      meal: 'breakfast',
      time: '08:05',
      sourceFoodId: 'oats',
      sourceFoodName: 'Oats',
      nutrients: nutrients(150, 5),
    });
    const existing = entry({ entryId: 'already', date: '2026-10-16', meal: 'breakfast', time: '07:30' });
    await upsertEntry(breakfast, null);
    await upsertEntry(oats, null);
    await upsertEntry(existing, null);
    const before = await getEntry('b1');

    const result = await saveCopiedEntries([
      draftFor(breakfast, 'copy-1', '2026-10-16', 200),
      draftFor(oats, 'copy-2', '2026-10-16'),
    ]);

    expect(result.count).toBe(2);
    expect(result.workbookSynced).toBe(false);
    expect(await getEntry('b1')).toEqual(before);
    expect(await getEntry('copy-1')).toMatchObject({
      date: '2026-10-16',
      meal: 'breakfast',
      quantity: 200,
      nutrients: expect.objectContaining({ calories: 330, protein: 62 }),
    });
    const day = (await getAllEntries()).filter((item) => item.date === '2026-10-16');
    expect(day.map((item) => item.entryId).sort()).toEqual(['already', 'copy-1', 'copy-2']);
    expect(calculateDailyTotals('2026-10-15', await getAllEntries()).calories).toBe(315);
    expect(calculateDailyTotals('2026-10-16', await getAllEntries()).entryCount).toBe(3);
    const pending = await getPendingWrites();
    expect(pending.map((item) => item.entryId).sort()).toEqual(['copy-1', 'copy-2']);
  });

  it('does not create a second record when copy is tapped twice or retried', async () => {
    const source = entry({ entryId: 'src', date: '2026-10-12', meal: 'lunch' });
    await upsertEntry(source, null);
    const drafts = [draftFor(source, 'copy-lunch', '2026-10-16')];
    const [first, second] = await Promise.all([saveCopiedEntries(drafts), saveCopiedEntries(drafts)]);
    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
    await saveCopiedEntries(drafts);
    const copies = (await getAllEntries()).filter((item) => item.entryId === 'copy-lunch');
    expect(copies).toHaveLength(1);
    expect(await getEntry('src')).toMatchObject({ quantity: 100, nutrients: source.nutrients });
  });

  it('rejects an invalid copy without writing records', async () => {
    const source = entry({ entryId: 'src', date: '2026-10-15', meal: 'dinner' });
    await upsertEntry(source, null);
    const bad = draftFor(source, 'src', '2026-10-16');
    bad.sourceEntryId = 'src';
    await expect(saveCopiedEntries([bad])).rejects.toThrow(/couldn’t copy/i);
    await expect(saveCopiedEntries([{ ...draftFor(source, 'copy', '2026-10-16'), quantity: 0 }])).rejects.toThrow(/weight/i);
    expect(await getAllEntries()).toHaveLength(1);
    expect((await getEntry('src'))?.updatedAt).toBe(source.updatedAt);
  });

  it('writes each copied food to the meal log once', async () => {
    const fixture = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../fixtures/food-log-destination.xlsx',
    );
    const bytes = fs.readFileSync(fixture);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const file = {
      name: 'food-log-destination.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: bytes.byteLength,
      lastModified: Date.now(),
      arrayBuffer: async () => buffer.slice(0),
    } as unknown as File;
    await importDestinationWorkbook(file, 'FoodLog');

    const source = entry({ entryId: 'src', date: '2026-10-14', meal: 'snack' });
    await upsertEntry(source, null);
    const drafts = [draftFor(source, 'copied-snack', '2026-10-16')];
    const saved = await saveCopiedEntries(drafts);
    expect(saved.workbookSynced).toBe(true);
    await saveCopiedEntries(drafts);

    const blob = await getBlob('destination');
    expect(blob).toBeTruthy();
    const workbook = XLSX.read(blob?.data, { type: 'array' });
    const found: string[] = [];
    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name] ?? {}, { header: 1, defval: '' });
      rows.forEach((row, index) => {
        row.forEach((cell, column) => {
          if (String(cell) === 'copied-snack') found.push(`${name} r${index} c${column}`);
        });
      });
    }
    expect(found).toEqual(['FoodLog r2 c0']);
    expect(await getPendingWrites()).toHaveLength(0);
  });
});

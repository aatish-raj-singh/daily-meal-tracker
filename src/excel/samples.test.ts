import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildMealLogSample, buildNutritionSample } from './samples';
import { appendNutritionRow, buildDefaultSourceConfig, readWorkbookFromBuffer } from './workbook';

describe('sample workbooks', () => {
  it('builds a nutrition sheet and an empty daily log', () => {
    const nutrition = XLSX.read(buildNutritionSample(), { type: 'array' });
    const foods = XLSX.utils.sheet_to_json<(string | number)[]>(nutrition.Sheets.Foods, { header: 1 });
    expect(foods[0]).toContain('Food Name');
    expect(foods[0]).toContain('Calories');
    expect(foods[1]?.[0]).toBe('Chicken Breast');

    const log = XLSX.read(buildMealLogSample(), { type: 'array' });
    const meals = XLSX.utils.sheet_to_json<string[]>(log.Sheets.Meals, { header: 1 });
    expect(meals[0]).toContain('Entry ID');
    expect(meals[0]).toContain('Food Name');
    expect(meals).toHaveLength(1);
  });

  it('appends a food row to the nutrition sheet', () => {
    const original = buildNutritionSample();
    const imported = readWorkbookFromBuffer(original, 'nutrition-sheet.xlsx');
    const config = buildDefaultSourceConfig(imported, 'Foods', 0);
    const next = appendNutritionRow(original, config, {
      foodId: 'rice',
      foodName: 'Rice',
      basisQuantity: 100,
      basisUnit: 'g',
      nutrients: { calories: 130, protein: 2.7 },
    });
    const book = XLSX.read(next, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets.Foods, { header: 1 });
    const added = rows[rows.length - 1];
    expect(added).toContain('Rice');
    expect(added).toContain(130);
  });
});

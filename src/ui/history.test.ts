import { describe, expect, it } from 'vitest';
import type { FoodEntry } from '../types';
import { groupHistory, isValidHistoryRange } from './history';

function entry(partial: Partial<FoodEntry> & Pick<FoodEntry, 'date' | 'time'>): FoodEntry {
  return {
    entryId: partial.entryId ?? partial.time,
    date: partial.date,
    time: partial.time,
    meal: partial.meal ?? 'breakfast',
    sourceFoodId: 'food',
    sourceFoodName: partial.sourceFoodName ?? 'Food',
    quantity: 100,
    unit: 'g',
    basisQuantity: 100,
    basisUnit: 'g',
    nutrients: {
      calories: 100,
      protein: 10,
      carbohydrates: 5,
      fat: 2,
      fiber: 1,
      sugar: null,
      sodium: null,
      saturatedFat: null,
      cholesterol: null,
      potassium: null,
      calcium: null,
      iron: null,
      vitaminC: null,
      vitaminA: null,
      ...partial.nutrients,
    },
    notes: '',
    sourceWorkbookSha256: '',
    sourceWorksheet: '',
    createdAt: '',
    updatedAt: '',
    syncStatus: 'synced',
    syncError: null,
    deletedAt: null,
  };
}

describe('history groups', () => {
  it('rejects an end date before the start date', () => {
    expect(isValidHistoryRange('2026-10-15', '2026-10-14')).toBe(false);
    expect(isValidHistoryRange('2026-10-15', '2026-10-15')).toBe(true);
  });

  it('groups the newest day first and totals that day’s entries', () => {
    const days = groupHistory([
      entry({ date: '2026-10-14', time: '08:00', nutrients: { calories: 100, protein: 10, carbohydrates: 4, fat: 1, fiber: 1, sugar: null, sodium: null, saturatedFat: null, cholesterol: null, potassium: null, calcium: null, iron: null, vitaminC: null, vitaminA: null } }),
      entry({ date: '2026-10-15', time: '09:00', nutrients: { calories: 200, protein: 20, carbohydrates: 8, fat: 3, fiber: null, sugar: null, sodium: null, saturatedFat: null, cholesterol: null, potassium: null, calcium: null, iron: null, vitaminC: null, vitaminA: null } }),
      entry({ date: '2026-10-15', time: '07:00', nutrients: { calories: 50, protein: 5, carbohydrates: 2, fat: 1, fiber: 2, sugar: null, sodium: null, saturatedFat: null, cholesterol: null, potassium: null, calcium: null, iron: null, vitaminC: null, vitaminA: null } }),
    ]);

    expect(days.map((day) => day.date)).toEqual(['2026-10-15', '2026-10-14']);
    expect(days[0]?.entries.map((item) => item.time)).toEqual(['09:00', '07:00']);
    expect(days[0]).toMatchObject({ calories: 250, protein: 25, carbohydrates: 10, fat: 4, fiber: 2 });
  });
});

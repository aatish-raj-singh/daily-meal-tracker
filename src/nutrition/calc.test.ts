import { describe, expect, it } from 'vitest';
import { calculateNutrients, emptyNutrients } from './calc';
import type { SourceFood } from '../types';

const chicken: SourceFood = {
  foodId: 'CHK-001',
  foodName: 'Chicken Breast',
  basisQuantity: 100,
  basisUnit: 'g',
  nutrients: {
    ...emptyNutrients(),
    calories: 165,
    protein: 31,
    carbohydrates: 0,
    fat: 3.6,
    fiber: 0,
  },
  rowIndex: 1,
  sourceWorksheet: 'FoodDB',
  sourceFileName: 'nutrition-source.xlsx',
};

describe('nutrition calculation', () => {
  it('scales 200 g chicken breast correctly', () => {
    const r = calculateNutrients({ sourceFood: chicken, quantity: 200, unit: 'g' });
    expect(r.ok).toBe(true);
    expect(r.nutrients.calories).toBe(330);
    expect(r.nutrients.protein).toBe(62);
    expect(r.nutrients.fat).toBe(7.2);
    expect(r.nutrients.carbohydrates).toBe(0);
  });

  it('keeps unknown nutrients as null', () => {
    const food: SourceFood = {
      ...chicken,
      nutrients: { ...emptyNutrients(), calories: 100, protein: null, carbohydrates: 10, fat: 1 },
    };
    const r = calculateNutrients({ sourceFood: food, quantity: 50, unit: 'g' });
    expect(r.ok).toBe(true);
    expect(r.nutrients.calories).toBe(50);
    expect(r.nutrients.protein).toBeNull();
    expect(r.missingAsUnknown).toContain('protein');
  });
});

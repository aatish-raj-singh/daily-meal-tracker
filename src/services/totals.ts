import type { DailyTotals, FoodEntry, MealCategory } from '../types';
import { sumNutrient } from '../nutrition/calc';

function emptyMealBucket() {
  return {
    calories: 0,
    protein: 0,
    carbohydrates: 0,
    fat: 0,
    fiber: 0,
    count: 0,
  };
}

export function calculateDailyTotals(date: string, entries: FoodEntry[]): DailyTotals {
  const active = entries.filter((e) => e.date === date && !e.deletedAt);
  const meals: MealCategory[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
  const byMeal = Object.fromEntries(meals.map((m) => [m, emptyMealBucket()])) as DailyTotals['byMeal'];

  for (const entry of active) {
    const bucket = byMeal[entry.meal];
    bucket.count += 1;
    bucket.calories += entry.nutrients.calories ?? 0;
    bucket.protein += entry.nutrients.protein ?? 0;
    bucket.carbohydrates += entry.nutrients.carbohydrates ?? 0;
    bucket.fat += entry.nutrients.fat ?? 0;
    bucket.fiber += entry.nutrients.fiber ?? 0;
  }

  const cal = sumNutrient(active, 'calories');
  const pro = sumNutrient(active, 'protein');
  const carb = sumNutrient(active, 'carbohydrates');
  const fat = sumNutrient(active, 'fat');
  const fiber = sumNutrient(active, 'fiber');
  const sugar = sumNutrient(active, 'sugar');

  const unknownNutrients: string[] = [];
  if (!cal.allKnown) unknownNutrients.push('calories');
  if (!pro.allKnown) unknownNutrients.push('protein');
  if (!carb.allKnown) unknownNutrients.push('carbohydrates');
  if (!fat.allKnown) unknownNutrients.push('fat');
  if (!fiber.allKnown) unknownNutrients.push('fiber');

  return {
    date,
    calories: round1(cal.total),
    protein: round1(pro.total),
    carbohydrates: round1(carb.total),
    fat: round1(fat.total),
    fiber: round1(fiber.total),
    sugar: round1(sugar.total),
    entryCount: active.length,
    unknownNutrients,
    byMeal,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Reconcile dashboard totals against a fresh sum of entries. */
export function totalsReconcile(
  totals: DailyTotals,
  entries: FoodEntry[],
): { ok: boolean; message: string } {
  const recomputed = calculateDailyTotals(totals.date, entries);
  const fields: Array<keyof Pick<DailyTotals, 'calories' | 'protein' | 'carbohydrates' | 'fat' | 'fiber' | 'entryCount'>> =
    ['calories', 'protein', 'carbohydrates', 'fat', 'fiber', 'entryCount'];

  for (const field of fields) {
    if (Math.abs(Number(totals[field]) - Number(recomputed[field])) > 0.05) {
      return {
        ok: false,
        message: `Mismatch on ${field}: displayed ${totals[field]} vs recomputed ${recomputed[field]}`,
      };
    }
  }
  return { ok: true, message: 'Daily totals reconcile with individual entries.' };
}

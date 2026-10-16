import { canViewEntry, getSessionAccount } from '../auth/accounts';
import { getEntriesByDate } from '../db/database';
import { calculateNutrients, emptyNutrients } from '../nutrition/calc';
import type { FoodEntry, MealCategory, NutrientValues, SourceFood } from '../types';
import { currentTimeLocal, newId, todayLocal } from '../util/hash';
import type { CopyEntryDraft } from './foodLog';

export interface CopyLine {
  entryId: string;
  sourceEntryId: string | null;
  sourceFoodId: string;
  sourceFoodName: string;
  quantity: number;
  unit: string;
  notes: string;
  unresolved: boolean;
  originalQuantity: number;
  originalUnit: string;
  originalNutrients: NutrientValues;
  basisQuantity: number;
  basisUnit: string;
  sourceWorkbookSha256: string;
  sourceWorksheet: string;
  time: string;
}

export interface LineNutrition {
  nutrients: NutrientValues;
  unresolved: boolean;
  review: boolean;
  error: string | null;
}

export function shiftLocalDate(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error('Enter a valid date.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('Enter a valid date.');
  }
  date.setDate(date.getDate() + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

export function yesterdayLocal(today = todayLocal()): string {
  return shiftLocalDate(today, -1);
}

export async function visibleEntriesOnDate(date: string): Promise<FoodEntry[]> {
  const account = await getSessionAccount();
  const rows = await getEntriesByDate(date);
  return rows.filter((entry) => (account ? canViewEntry(entry.ownerEmail, account) : true));
}

export async function entriesForMeal(date: string, meal: MealCategory): Promise<FoodEntry[]> {
  const rows = await visibleEntriesOnDate(date);
  return rows.filter((entry) => entry.meal === meal).sort((a, b) => a.time.localeCompare(b.time));
}

export function copyLineFromEntry(entry: FoodEntry, foods: SourceFood[]): CopyLine {
  return {
    entryId: newId(),
    sourceEntryId: entry.entryId,
    sourceFoodId: entry.sourceFoodId,
    sourceFoodName: entry.sourceFoodName,
    quantity: entry.quantity,
    unit: entry.unit,
    notes: entry.notes,
    unresolved: !foods.some((food) => food.foodId === entry.sourceFoodId),
    originalQuantity: entry.quantity,
    originalUnit: entry.unit,
    originalNutrients: { ...entry.nutrients },
    basisQuantity: entry.basisQuantity,
    basisUnit: entry.basisUnit,
    sourceWorkbookSha256: entry.sourceWorkbookSha256,
    sourceWorksheet: entry.sourceWorksheet,
    time: entry.time,
  };
}

export function copyLineFromFood(
  food: SourceFood,
  quantity: number,
  unit: string,
  rounding: { caloriesDecimals: number; macroDecimals: number },
): CopyLine {
  const calc = calculateNutrients({
    sourceFood: food,
    quantity,
    unit,
    caloriesDecimals: rounding.caloriesDecimals,
    macroDecimals: rounding.macroDecimals,
  });
  if (!calc.ok) throw new Error(calc.error ?? 'Unable to calculate nutrition for this quantity/unit.');
  return {
    entryId: newId(),
    sourceEntryId: null,
    sourceFoodId: food.foodId,
    sourceFoodName: food.foodName,
    quantity,
    unit,
    notes: '',
    unresolved: false,
    originalQuantity: quantity,
    originalUnit: unit,
    originalNutrients: calc.nutrients,
    basisQuantity: food.basisQuantity,
    basisUnit: food.basisUnit,
    sourceWorkbookSha256: '',
    sourceWorksheet: food.sourceWorksheet,
    time: currentTimeLocal(),
  };
}

export function lineNutrients(
  line: CopyLine,
  foods: SourceFood[],
  rounding: { caloriesDecimals: number; macroDecimals: number },
): LineNutrition {
  const unchanged = line.quantity === line.originalQuantity && line.unit === line.originalUnit;
  const catalogue = foods.find((food) => food.foodId === line.sourceFoodId) ?? null;
  const unresolved = catalogue === null;
  if (unchanged) {
    return {
      nutrients: { ...line.originalNutrients },
      unresolved,
      review: unresolved,
      error: null,
    };
  }

  const sourceFood = catalogue ?? syntheticFood(line);
  const calc = calculateNutrients({
    sourceFood,
    quantity: line.quantity,
    unit: line.unit,
    caloriesDecimals: rounding.caloriesDecimals,
    macroDecimals: rounding.macroDecimals,
  });
  if (!calc.ok) {
    return {
      nutrients: emptyNutrients(),
      unresolved,
      review: unresolved,
      error: calc.error ?? 'Unable to calculate nutrition for this quantity/unit.',
    };
  }
  return {
    nutrients: calc.nutrients,
    unresolved,
    review: unresolved,
    error: null,
  };
}

export function draftFromLine(
  line: CopyLine,
  date: string,
  meal: MealCategory,
  nutrients: NutrientValues,
): CopyEntryDraft {
  return {
    entryId: line.entryId,
    sourceEntryId: line.sourceEntryId,
    date,
    time: line.time,
    meal,
    sourceFoodId: line.sourceFoodId,
    sourceFoodName: line.sourceFoodName,
    quantity: line.quantity,
    unit: line.unit,
    basisQuantity: line.basisQuantity,
    basisUnit: line.basisUnit,
    nutrients,
    notes: line.notes,
    sourceWorkbookSha256: line.sourceWorkbookSha256,
    sourceWorksheet: line.sourceWorksheet,
  };
}

function syntheticFood(line: CopyLine): SourceFood {
  return {
    foodId: line.sourceFoodId,
    foodName: line.sourceFoodName,
    basisQuantity: line.originalQuantity,
    basisUnit: line.originalUnit,
    nutrients: line.originalNutrients,
    rowIndex: -1,
    sourceWorksheet: line.sourceWorksheet,
    sourceFileName: '',
  };
}

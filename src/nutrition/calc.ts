import type { NutrientValues, SourceFood } from '../types';
import { conversionFactor } from './units';

export interface CalcInput {
  sourceFood: SourceFood;
  quantity: number;
  unit: string;
  caloriesDecimals?: number;
  macroDecimals?: number;
}

export interface CalcResult {
  ok: boolean;
  nutrients: NutrientValues;
  factor: number;
  error?: string;
  missingAsUnknown: string[];
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function scaleNutrient(
  value: number | null,
  factor: number,
  decimals: number,
): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return roundTo(value * factor, decimals);
}

/**
 * Rounding policy:
 * - Calories: 0 decimal places by default
 * - Macros/micros: 1 decimal place by default
 * - Null source values stay null (unknown). They are never coerced to zero.
 */
export function calculateNutrients(input: CalcInput): CalcResult {
  const caloriesDecimals = input.caloriesDecimals ?? 0;
  const macroDecimals = input.macroDecimals ?? 1;

  const conv = conversionFactor(
    input.quantity,
    input.unit,
    input.sourceFood.basisQuantity,
    input.sourceFood.basisUnit,
  );

  if (!conv.ok) {
    return {
      ok: false,
      nutrients: emptyNutrients(),
      factor: 0,
      error: conv.error,
      missingAsUnknown: [],
    };
  }

  const src = input.sourceFood.nutrients;
  const missingAsUnknown: string[] = [];
  const nutrients = emptyNutrients();

  for (const key of Object.keys(src)) {
    const raw = src[key];
    if (raw === null || raw === undefined || Number.isNaN(Number(raw))) {
      nutrients[key] = null;
      missingAsUnknown.push(key);
      continue;
    }
    const decimals = key === 'calories' ? caloriesDecimals : macroDecimals;
    nutrients[key] = scaleNutrient(Number(raw), conv.factor, decimals);
  }

  return {
    ok: true,
    nutrients,
    factor: conv.factor,
    missingAsUnknown,
  };
}

export function emptyNutrients(): NutrientValues {
  return {
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    fiber: null,
    sugar: null,
    sodium: null,
    saturatedFat: null,
    cholesterol: null,
    potassium: null,
    calcium: null,
    iron: null,
    vitaminC: null,
    vitaminA: null,
  };
}

export function sumNutrient(
  entries: Array<{ nutrients: NutrientValues }>,
  key: keyof NutrientValues,
): { total: number; allKnown: boolean; unknownCount: number } {
  let total = 0;
  let unknownCount = 0;
  for (const entry of entries) {
    const v = entry.nutrients[key];
    if (v === null || v === undefined || Number.isNaN(Number(v))) {
      unknownCount += 1;
    } else {
      total += Number(v);
    }
  }
  return { total, allKnown: unknownCount === 0, unknownCount };
}

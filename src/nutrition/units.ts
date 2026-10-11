export type UnitKind = 'mass' | 'volume' | 'count' | 'unknown';

/** Convert mass/volume units to canonical grams or milliliters where possible. */
const MASS_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  fl_oz: 29.5735,
  'fl oz': 29.5735,
};

const COUNT_UNITS = new Set([
  'serving',
  'servings',
  'piece',
  'pieces',
  'unit',
  'units',
  'each',
  'item',
  'items',
  'slice',
  'slices',
  'scoop',
  'scoops',
]);

export function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\./g, '');
}

export function unitKind(unit: string): UnitKind {
  const u = normalizeUnit(unit);
  if (MASS_TO_G[u] !== undefined) return 'mass';
  if (VOLUME_TO_ML[u] !== undefined) return 'volume';
  if (COUNT_UNITS.has(u)) return 'count';
  return 'unknown';
}

export interface ConversionResult {
  ok: boolean;
  factor: number;
  error?: string;
}

/**
 * Returns a multiplicative factor so that:
 * nutrient = sourceNutrient * (userQuantity / basisQuantity) * factorAdjustment
 * where factorAdjustment accounts for unit conversion between user unit and basis unit.
 */
export function conversionFactor(
  quantity: number,
  quantityUnit: string,
  basisQuantity: number,
  basisUnit: string,
): ConversionResult {
  if (!(quantity > 0)) {
    return { ok: false, factor: 0, error: 'Quantity must be greater than zero.' };
  }
  if (!(basisQuantity > 0)) {
    return { ok: false, factor: 0, error: 'Nutrition basis quantity must be greater than zero.' };
  }

  const qUnit = normalizeUnit(quantityUnit);
  const bUnit = normalizeUnit(basisUnit);

  if (qUnit === bUnit) {
    return { ok: true, factor: quantity / basisQuantity };
  }

  const qKind = unitKind(qUnit);
  const bKind = unitKind(bUnit);

  if (qKind === 'mass' && bKind === 'mass') {
    const qGrams = quantity * MASS_TO_G[qUnit];
    const bGrams = basisQuantity * MASS_TO_G[bUnit];
    return { ok: true, factor: qGrams / bGrams };
  }

  if (qKind === 'volume' && bKind === 'volume') {
    const qMl = quantity * VOLUME_TO_ML[qUnit];
    const bMl = basisQuantity * VOLUME_TO_ML[bUnit];
    return { ok: true, factor: qMl / bMl };
  }

  if (qKind === 'count' && bKind === 'count') {
    // Treat count units as interchangeable only when labels match after normalization
    // or both are generic "serving/unit/piece" family with same semantic count.
    if (qUnit === bUnit) {
      return { ok: true, factor: quantity / basisQuantity };
    }
    return {
      ok: false,
      factor: 0,
      error: `Cannot convert between count units "${quantityUnit}" and "${basisUnit}". Use the same unit as the nutrition basis.`,
    };
  }

  return {
    ok: false,
    factor: 0,
    error: `Cannot convert "${quantityUnit}" to basis unit "${basisUnit}". Choose a compatible unit.`,
  };
}

export function compatibleUnitsFor(basisUnit: string): string[] {
  const kind = unitKind(basisUnit);
  switch (kind) {
    case 'mass':
      return ['g', 'kg', 'mg', 'oz', 'lb'];
    case 'volume':
      return ['ml', 'l', 'cup', 'tbsp', 'tsp', 'fl oz'];
    case 'count':
      return [normalizeUnit(basisUnit) || 'serving'];
    case 'unknown':
      return [basisUnit];
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

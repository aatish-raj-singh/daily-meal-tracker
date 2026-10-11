import type { DestinationField, SourceField } from '../types';

const SOURCE_ALIASES: Record<SourceField, string[]> = {
  foodId: ['food id', 'food_id', 'id', 'item id', 'item_id', 'code', 'food code'],
  foodName: ['food name', 'food', 'name', 'item', 'item name', 'description', 'food_name'],
  basisQuantity: [
    'basis quantity',
    'basis qty',
    'serving size',
    'serving_qty',
    'per',
    'qty',
    'quantity',
    'amount',
    'basis',
  ],
  basisUnit: ['basis unit', 'unit', 'serving unit', 'uom', 'measure'],
  calories: ['calories', 'kcal', 'energy', 'cal'],
  protein: ['protein', 'proteins', 'protein_g', 'protein (g)'],
  carbohydrates: [
    'carbohydrates',
    'carbs',
    'carbohydrate',
    'carb',
    'total carbohydrate',
    'total carbs',
  ],
  fat: ['fat', 'fats', 'total fat', 'total_fat', 'fat_g'],
  fiber: ['fiber', 'fibre', 'dietary fiber', 'dietary fibre'],
  sugar: ['sugar', 'sugars', 'total sugar', 'total sugars'],
  sodium: ['sodium', 'salt', 'na'],
  saturatedFat: ['saturated fat', 'sat fat', 'saturated', 'sat_fat'],
  cholesterol: ['cholesterol', 'chol'],
  potassium: ['potassium', 'k'],
  calcium: ['calcium', 'ca'],
  iron: ['iron', 'fe'],
  vitaminC: ['vitamin c', 'vit c', 'vitc', 'ascorbic acid'],
  vitaminA: ['vitamin a', 'vit a', 'vita'],
};

const DESTINATION_ALIASES: Record<DestinationField, string[]> = {
  entryId: ['entry_id', 'entry id', 'id', 'uuid', 'log id'],
  date: ['date', 'log date', 'day'],
  time: ['time', 'log time'],
  meal: ['meal', 'meal type', 'meal_category', 'category'],
  foodId: ['food id', 'food_id', 'item id'],
  foodName: ['food name', 'food', 'name', 'item'],
  quantity: ['quantity', 'qty', 'amount'],
  unit: ['unit', 'uom', 'measure'],
  calories: ['calories', 'kcal', 'energy', 'cal'],
  protein: ['protein', 'proteins'],
  carbohydrates: ['carbohydrates', 'carbs', 'carbohydrate'],
  fat: ['fat', 'fats', 'total fat'],
  fiber: ['fiber', 'fibre'],
  notes: ['notes', 'note', 'comment', 'comments'],
  basisQuantity: ['basis quantity', 'basis qty', 'serving size'],
  basisUnit: ['basis unit', 'serving unit'],
  sourceFoodId: ['source food id', 'source_food_id', 'source id'],
  lastModified: ['last modified', 'updated', 'updated at', 'modified'],
};

function normalizeHeader(header: unknown): string {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function suggestSourceMapping(
  headers: string[],
): Partial<Record<SourceField, number | null>> {
  return suggestMapping(headers, SOURCE_ALIASES);
}

export function suggestDestinationMapping(
  headers: string[],
): Partial<Record<DestinationField, number | null>> {
  return suggestMapping(headers, DESTINATION_ALIASES);
}

function suggestMapping<T extends string>(
  headers: string[],
  aliases: Record<T, string[]>,
): Partial<Record<T, number | null>> {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Partial<Record<T, number | null>> = {};

  for (const field of Object.keys(aliases) as T[]) {
    let found: number | null = null;
    for (const alias of aliases[field]) {
      const idx = normalized.findIndex((h, i) => !used.has(i) && h === alias);
      if (idx >= 0) {
        found = idx;
        break;
      }
    }
    if (found === null) {
      for (const alias of aliases[field]) {
        const idx = normalized.findIndex((h, i) => !used.has(i) && h.includes(alias));
        if (idx >= 0) {
          found = idx;
          break;
        }
      }
    }
    mapping[field] = found;
    if (found !== null) used.add(found);
  }

  return mapping;
}

export function requiredSourceFieldsMapped(
  mapping: Partial<Record<SourceField, number | null>>,
): string[] {
  const required: SourceField[] = [
    'foodName',
    'basisQuantity',
    'basisUnit',
    'calories',
    'protein',
    'carbohydrates',
    'fat',
  ];
  return required.filter((f) => mapping[f] === null || mapping[f] === undefined);
}

export function requiredDestinationFieldsMapped(
  mapping: Partial<Record<DestinationField, number | null>>,
): string[] {
  const required: DestinationField[] = [
    'entryId',
    'date',
    'meal',
    'foodName',
    'quantity',
    'unit',
    'calories',
    'protein',
    'carbohydrates',
    'fat',
  ];
  return required.filter((f) => mapping[f] === null || mapping[f] === undefined);
}

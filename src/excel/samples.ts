import * as XLSX from 'xlsx';

const NUTRITION_HEADERS = [
  'Food Name',
  'Basis Quantity',
  'Basis Unit',
  'Calories',
  'Protein',
  'Carbohydrates',
  'Fat',
  'Fiber',
  'Sugar',
  'Sodium',
  'Saturated Fat',
  'Cholesterol',
  'Potassium',
  'Calcium',
  'Iron',
  'Vitamin C',
  'Vitamin A',
];

const MEAL_LOG_HEADERS = [
  'Entry ID',
  'Date',
  'Time',
  'Meal',
  'Food ID',
  'Food Name',
  'Quantity',
  'Unit',
  'Calories',
  'Protein',
  'Carbohydrates',
  'Fat',
  'Fiber',
  'Notes',
  'Basis Quantity',
  'Basis Unit',
  'Source Food ID',
  'Last Modified',
];

function workbookBytes(sheetName: string, rows: unknown[][]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[];
  if (out instanceof ArrayBuffer) return out;
  if (out instanceof Uint8Array) {
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  }
  return Uint8Array.from(out).buffer as ArrayBuffer;
}

export function buildNutritionSample(): ArrayBuffer {
  return workbookBytes('Foods', [
    NUTRITION_HEADERS,
    ['Chicken Breast', 100, 'g', 165, 31, 0, 3.6, 0, 0, 74, 1, 85, 256, 15, 1, 1.2, 18],
  ]);
}

export function buildMealLogSample(): ArrayBuffer {
  return workbookBytes('Meals', [MEAL_LOG_HEADERS]);
}

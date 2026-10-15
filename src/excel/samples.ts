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

export function buildWorkoutSample(): ArrayBuffer {
  const headers = ['Day', 'Exercise', 'Sets', 'Reps', 'Notes'];
  const rows = [
    headers,
    ['Monday', 'Bench Press', 4, 8, ''],
    ['Monday', 'Overhead Press', 3, 8, ''],
    ['Monday', 'Lateral Raise', 3, 12, ''],
    ['Tuesday', 'Pull Up', 4, 6, ''],
    ['Tuesday', 'Barbell Row', 4, 8, ''],
    ['Tuesday', 'Barbell Curl', 3, 10, ''],
    ['Wednesday', 'Squat', 4, 6, ''],
    ['Wednesday', 'Romanian Deadlift', 3, 8, ''],
    ['Wednesday', 'Calf Raise', 3, 15, ''],
    ['Thursday', 'Incline Bench Press', 4, 8, ''],
    ['Thursday', 'Dumbbell Shoulder Press', 3, 10, ''],
    ['Thursday', 'Tricep Pushdown', 3, 12, ''],
    ['Friday', 'Lat Pulldown', 4, 10, ''],
    ['Friday', 'Seated Cable Row', 3, 10, ''],
    ['Friday', 'Hammer Curl', 3, 10, ''],
    ['Saturday', 'Front Squat', 4, 8, ''],
    ['Saturday', 'Walking Lunge', 3, 10, ''],
    ['Saturday', 'Leg Curl', 3, 12, ''],
  ];
  return workbookBytes('Plan', rows);
}

export function buildMealLogSample(): ArrayBuffer {
  return workbookBytes('Meals', [MEAL_LOG_HEADERS]);
}

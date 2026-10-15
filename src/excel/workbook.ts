import * as XLSX from 'xlsx';
import type {
  DestinationField,
  DestinationWorkbookConfig,
  FeatureWarnings,
  FoodEntry,
  SourceField,
  SourceFood,
  SourceWorkbookConfig,
  WorkbookIdentity,
  WorkoutExercise,
  WorkoutWorkbookConfig,
} from '../types';
import { emptyNutrients } from '../nutrition/calc';
import { sha256Hex, nowIso } from '../util/hash';
import { detectWorkbookFeatures } from './features';
import { suggestDestinationMapping, suggestSourceMapping, suggestWorkoutMapping } from './mapping';

export interface ImportedWorkbook {
  identity: WorkbookIdentity;
  workbook: XLSX.WorkBook;
  sheetNames: string[];
  warnings: FeatureWarnings;
  data: ArrayBuffer;
}

export interface SheetPreview {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  rows: string[][];
  totalRows: number;
}

function assertXlsxFile(file: File): void {
  const name = file.name.toLowerCase();
  const okExt = name.endsWith('.xlsx') || name.endsWith('.xlsm') || name.endsWith('.xls');
  const okType =
    !file.type ||
    file.type.includes('sheet') ||
    file.type.includes('excel') ||
    file.type === 'application/octet-stream' ||
    file.type === '';
  if (!okExt || !okType) {
    throw new Error('Please select an Excel file (.xlsx preferred).');
  }
}

export async function importWorkbookFile(file: File): Promise<ImportedWorkbook> {
  assertXlsxFile(file);
  const data = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, {
      type: 'array',
      cellDates: true,
      cellNF: false,
      cellText: false,
      bookVBA: true,
    });
  } catch {
    throw new Error('Couldn’t open this Excel file. Use an .xlsx file.');
  }

  if (!workbook.SheetNames.length) {
    throw new Error('This Excel file has no sheets.');
  }

  const identity: WorkbookIdentity = {
    fileName: file.name,
    importedAt: nowIso(),
    byteLength: data.byteLength,
    sha256: await sha256Hex(data),
  };

  return {
    identity,
    workbook,
    sheetNames: [...workbook.SheetNames],
    warnings: detectWorkbookFeatures(workbook, file.name),
    data,
  };
}

export function readWorkbookFromBuffer(data: ArrayBuffer, fileName: string): ImportedWorkbook {
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: true,
    bookVBA: true,
  });
  return {
    identity: {
      fileName,
      importedAt: nowIso(),
      byteLength: data.byteLength,
      sha256: '',
    },
    workbook,
    sheetNames: [...workbook.SheetNames],
    warnings: detectWorkbookFeatures(workbook, fileName),
    data,
  };
}

export function previewSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  headerRowIndex = 0,
  maxRows = 8,
): SheetPreview {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`The sheet “${sheetName}” isn’t in this file.`);

  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  const headers = (rows[headerRowIndex] ?? []).map((c) => String(c ?? ''));
  const dataRows = rows
    .slice(headerRowIndex + 1, headerRowIndex + 1 + maxRows)
    .map((r) => headers.map((_, i) => String(r[i] ?? '')));

  return {
    sheetName,
    headerRowIndex,
    headers,
    rows: dataRows,
    totalRows: Math.max(0, rows.length - headerRowIndex - 1),
  };
}

export function buildDefaultSourceConfig(
  imported: ImportedWorkbook,
  worksheetName: string,
  headerRowIndex = 0,
): SourceWorkbookConfig {
  const preview = previewSheet(imported.workbook, worksheetName, headerRowIndex);
  return {
    identity: imported.identity,
    worksheetName,
    headerRowIndex,
    mapping: suggestSourceMapping(preview.headers),
    previewHeaders: preview.headers,
    mappingSaved: false,
  };
}

export function buildDefaultWorkoutConfig(
  imported: ImportedWorkbook,
  worksheetName: string,
  headerRowIndex = 0,
): WorkoutWorkbookConfig {
  const preview = previewSheet(imported.workbook, worksheetName, headerRowIndex);
  return {
    identity: imported.identity,
    worksheetName,
    headerRowIndex,
    mapping: suggestWorkoutMapping(preview.headers),
    previewHeaders: preview.headers,
    mappingSaved: false,
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function weekdayName(isoDate: string): (typeof WEEKDAYS)[number] {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return WEEKDAYS[date.getDay()] ?? 'Sunday';
}

export function exercisesForWeekday(rows: WorkoutExercise[], weekday: string): WorkoutExercise[] {
  return rows.filter((row) => dayMatches(row.day, weekday));
}

export function loadWorkoutExercises(
  workbook: XLSX.WorkBook,
  config: WorkoutWorkbookConfig,
): WorkoutExercise[] {
  const sheet = workbook.Sheets[config.worksheetName];
  if (!sheet) throw new Error(`The sheet “${config.worksheetName}” isn’t in your workout plan.`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  const map = config.mapping;
  const exercises: WorkoutExercise[] = [];
  for (let i = config.headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const day = cellString(row[map.day ?? -1]);
    const exercise = cellString(row[map.exercise ?? -1]);
    if (!day || !exercise) continue;
    exercises.push({
      day,
      exercise,
      sets: cellString(row[map.sets ?? -1]),
      reps: cellString(row[map.reps ?? -1]),
      notes: cellString(row[map.notes ?? -1]),
    });
  }
  return exercises;
}

function dayMatches(value: string, weekday: string): boolean {
  const cell = value.trim().toLowerCase();
  const full = weekday.trim().toLowerCase();
  const short = full.slice(0, 3);
  return cell === full || cell === short || cell.startsWith(`${full} `) || cell.startsWith(`${full}-`) || cell.startsWith(`${short} `);
}

const NUTRITION_VALUE_FIELDS = [
  'calories',
  'protein',
  'carbohydrates',
  'fat',
  'fiber',
  'sugar',
  'sodium',
  'saturatedFat',
  'cholesterol',
  'potassium',
  'calcium',
  'iron',
  'vitaminC',
  'vitaminA',
] as const satisfies readonly SourceField[];

export interface NutritionSheetRow {
  foodId: string;
  foodName: string;
  basisQuantity: number;
  basisUnit: string;
  nutrients: Partial<Record<(typeof NUTRITION_VALUE_FIELDS)[number], number | null>>;
}

export function appendNutritionRow(
  data: ArrayBuffer,
  config: SourceWorkbookConfig,
  row: NutritionSheetRow,
): ArrayBuffer {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true, bookVBA: true });
  const sheetNamesBefore = [...workbook.SheetNames];
  const sheet = workbook.Sheets[config.worksheetName];
  if (!sheet) throw new Error(`The sheet “${config.worksheetName}” isn’t in your food list.`);

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  });
  while (aoa.length <= config.headerRowIndex) aoa.push([]);

  const line: unknown[] = [];
  const setCell = (field: SourceField, value: string | number | null | undefined) => {
    const col = config.mapping[field];
    if (col === null || col === undefined || value === null || value === undefined || value === '') return;
    while (line.length <= col) line.push('');
    line[col] = value;
  };

  setCell('foodId', row.foodId);
  setCell('foodName', row.foodName);
  setCell('basisQuantity', row.basisQuantity);
  setCell('basisUnit', row.basisUnit);
  for (const field of NUTRITION_VALUE_FIELDS) {
    setCell(field, row.nutrients[field]);
  }

  aoa.push(line);
  const newSheet = XLSX.utils.aoa_to_sheet(aoa);
  const preserved = XLSX.utils.book_new();
  for (const name of sheetNamesBefore) {
    const next = name === config.worksheetName ? newSheet : workbook.Sheets[name];
    if (!next) throw new Error(`The sheet “${name}” isn’t in your food list.`);
    XLSX.utils.book_append_sheet(preserved, next, name);
  }

  const out = XLSX.write(preserved, { type: 'array', bookType: 'xlsx', bookSST: false });
  if (out instanceof ArrayBuffer) return out;
  if (out instanceof Uint8Array) {
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  }
  return Uint8Array.from(out as number[]).buffer as ArrayBuffer;
}

export function buildDefaultDestinationConfig(
  imported: ImportedWorkbook,
  worksheetName: string,
  headerRowIndex = 0,
): DestinationWorkbookConfig {
  const preview = previewSheet(imported.workbook, worksheetName, headerRowIndex);
  return {
    identity: imported.identity,
    worksheetName,
    headerRowIndex,
    mapping: suggestDestinationMapping(preview.headers),
    previewHeaders: preview.headers,
    lastVerifiedExportAt: null,
    lastBackupAt: null,
    mappingSaved: false,
  };
}

function cellNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export function loadSourceFoods(
  workbook: XLSX.WorkBook,
  config: SourceWorkbookConfig,
): SourceFood[] {
  const sheet = workbook.Sheets[config.worksheetName];
  if (!sheet) throw new Error(`The sheet “${config.worksheetName}” isn’t in your food list.`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  });

  const foods: SourceFood[] = [];
  const map = config.mapping;

  for (let i = config.headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const foodName = cellString(row[map.foodName ?? -1]);
    if (!foodName) continue;

    const foodId = cellString(row[map.foodId ?? -1]) || `row-${i}`;
    const basisQuantity = cellNumber(row[map.basisQuantity ?? -1]);
    const basisUnit = cellString(row[map.basisUnit ?? -1]);
    if (basisQuantity === null || !basisUnit) continue;

    const nutrients = emptyNutrients();
    const nutrientFields: SourceField[] = [
      'calories',
      'protein',
      'carbohydrates',
      'fat',
      'fiber',
      'sugar',
      'sodium',
      'saturatedFat',
      'cholesterol',
      'potassium',
      'calcium',
      'iron',
      'vitaminC',
      'vitaminA',
    ];
    for (const field of nutrientFields) {
      const col = map[field];
      nutrients[field] = col === null || col === undefined ? null : cellNumber(row[col]);
    }

    foods.push({
      foodId,
      foodName,
      basisQuantity,
      basisUnit,
      nutrients,
      rowIndex: i,
      sourceWorksheet: config.worksheetName,
      sourceFileName: config.identity.fileName,
    });
  }

  return foods;
}

export function searchSourceFoods(foods: SourceFood[], query: string, limit = 25): SourceFood[] {
  const q = query.trim().toLowerCase();
  if (!q) return foods.slice(0, limit);
  return foods
    .filter(
      (f) =>
        f.foodName.toLowerCase().includes(q) || f.foodId.toLowerCase().includes(q),
    )
    .slice(0, limit);
}

function ensureHeaderRow(
  sheetRows: unknown[][],
  headerRowIndex: number,
  mapping: Partial<Record<DestinationField, number | null>>,
  existingHeaders: string[],
): unknown[][] {
  const rows = sheetRows.map((r) => [...(r ?? [])]);
  while (rows.length <= headerRowIndex) rows.push([]);

  const headers = [...(rows[headerRowIndex] ?? [])] as unknown[];
  const ensure = (field: DestinationField, label: string) => {
    if (mapping[field] !== null && mapping[field] !== undefined) return;
    // Auto-append missing required columns for new/empty logs
    const col = Math.max(headers.length, existingHeaders.length);
    headers[col] = label;
    mapping[field] = col;
  };

  ensure('entryId', 'Entry_ID');
  ensure('date', 'Date');
  ensure('time', 'Time');
  ensure('meal', 'Meal');
  ensure('foodName', 'Food_Name');
  ensure('quantity', 'Quantity');
  ensure('unit', 'Unit');
  ensure('calories', 'Calories');
  ensure('protein', 'Protein');
  ensure('carbohydrates', 'Carbohydrates');
  ensure('fat', 'Fat');
  ensure('fiber', 'Fiber');
  ensure('notes', 'Notes');
  ensure('sourceFoodId', 'Source_Food_ID');
  ensure('lastModified', 'Last_Modified');

  rows[headerRowIndex] = headers;
  return rows;
}

function entryToRow(
  entry: FoodEntry,
  mapping: Partial<Record<DestinationField, number | null>>,
  width: number,
): unknown[] {
  const row: unknown[] = Array.from({ length: width }, () => '');
  const set = (field: DestinationField, value: unknown) => {
    const col = mapping[field];
    if (col === null || col === undefined) return;
    row[col] = value === null || value === undefined ? '' : value;
  };

  set('entryId', entry.entryId);
  set('date', entry.date);
  set('time', entry.time);
  set('meal', entry.meal);
  set('foodId', entry.sourceFoodId);
  set('foodName', entry.sourceFoodName);
  set('quantity', entry.quantity);
  set('unit', entry.unit);
  set('calories', entry.nutrients.calories);
  set('protein', entry.nutrients.protein);
  set('carbohydrates', entry.nutrients.carbohydrates);
  set('fat', entry.nutrients.fat);
  set('fiber', entry.nutrients.fiber);
  set('notes', entry.notes);
  set('basisQuantity', entry.basisQuantity);
  set('basisUnit', entry.basisUnit);
  set('sourceFoodId', entry.sourceFoodId);
  set('lastModified', entry.updatedAt);
  return row;
}

export interface DestinationApplyResult {
  workbookBytes: ArrayBuffer;
  rowCountForEntry: number;
  verified: boolean;
  sheetNames: string[];
}

/**
 * Upsert or delete a food entry in the destination workbook working copy by Entry_ID.
 * Preserves other worksheets in the SheetJS workbook object.
 */
export function applyEntryToDestinationWorkbook(
  data: ArrayBuffer,
  config: DestinationWorkbookConfig,
  entry: FoodEntry,
  operation: 'upsert' | 'delete',
): DestinationApplyResult {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true, bookVBA: true });
  const sheetNamesBefore = [...workbook.SheetNames];

  if (!workbook.Sheets[config.worksheetName]) {
    // Create destination sheet if missing
    workbook.Sheets[config.worksheetName] = XLSX.utils.aoa_to_sheet([[]]);
    if (!workbook.SheetNames.includes(config.worksheetName)) {
      workbook.SheetNames.push(config.worksheetName);
    }
  }

  const sheet = workbook.Sheets[config.worksheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false,
  });

  const mapping = { ...config.mapping };
  const rows = ensureHeaderRow(aoa, config.headerRowIndex, mapping, config.previewHeaders);
  const headers = rows[config.headerRowIndex] as unknown[];
  const width = Math.max(headers.length, 16);
  const entryIdCol = mapping.entryId;
  if (entryIdCol === null || entryIdCol === undefined) {
    throw new Error('Match the Entry ID column in your meal log.');
  }

  // Remove existing rows with this Entry_ID (idempotent)
  const kept: unknown[][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i <= config.headerRowIndex) {
      kept.push(rows[i]);
      continue;
    }
    const id = cellString(rows[i][entryIdCol]);
    if (id === entry.entryId) continue;
    kept.push(rows[i]);
  }

  if (operation === 'upsert' && !entry.deletedAt) {
    kept.push(entryToRow(entry, mapping, width));
  }

  const newSheet = XLSX.utils.aoa_to_sheet(kept);
  workbook.Sheets[config.worksheetName] = newSheet;

  // Rebuild a workbook explicitly so unrelated sheets remain in SheetNames order.
  const preserved = XLSX.utils.book_new();
  for (const name of sheetNamesBefore) {
    const sheet =
      name === config.worksheetName ? newSheet : workbook.Sheets[name];
    if (!sheet) {
      throw new Error(`The sheet “${name}” is missing from the meal log.`);
    }
    XLSX.utils.book_append_sheet(preserved, sheet, name);
  }
  for (const name of workbook.SheetNames) {
    if (!sheetNamesBefore.includes(name)) {
      XLSX.utils.book_append_sheet(preserved, workbook.Sheets[name], name);
    }
  }

  const out = XLSX.write(preserved, {
    type: 'array',
    bookType: 'xlsx',
    bookSST: false,
  });
  const bytes =
    out instanceof ArrayBuffer
      ? out
      : out instanceof Uint8Array
        ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
        : Uint8Array.from(out as number[]).buffer;

  // Verify
  const verifyWb = XLSX.read(bytes, { type: 'array' });
  const verifySheet = verifyWb.Sheets[config.worksheetName];
  if (!verifySheet) {
    throw new Error(`The sheet “${config.worksheetName}” is missing from the meal log.`);
  }
  const verifyRows = XLSX.utils.sheet_to_json<unknown[]>(verifySheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  let matches = 0;
  for (let i = config.headerRowIndex + 1; i < verifyRows.length; i++) {
    if (cellString(verifyRows[i][entryIdCol]) === entry.entryId) matches += 1;
  }

  const expected = operation === 'delete' || entry.deletedAt ? 0 : 1;
  const verified = matches === expected;

  // Confirm other sheets still present
  for (const name of sheetNamesBefore) {
    if (!verifyWb.SheetNames.includes(name)) {
      throw new Error(`The sheet “${name}” was missing from the downloaded file.`);
    }
  }

  return {
    workbookBytes: bytes as ArrayBuffer,
    rowCountForEntry: matches,
    verified,
    sheetNames: [...verifyWb.SheetNames],
  };
}

export function workbookToBlob(data: ArrayBuffer): Blob {
  return new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function exportFileName(originalName: string, kind: 'backup' | 'export'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = originalName.replace(/\.(xlsx|xlsm|xls)$/i, '');
  return `${base}.${kind}.${stamp}.xlsx`;
}

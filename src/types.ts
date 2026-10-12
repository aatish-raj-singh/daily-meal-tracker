export const APP_VERSION = '1.2.0';
export const DB_NAME = 'daily-meal-tracker';
export const DB_VERSION = 3;
export const ADMIN_EMAIL = 'biasthakur.aatish@gmail.com';

export type MealCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

export type SyncStatus = 'synced' | 'pending' | 'failed' | 'local_only';

export type SourceField =
  | 'foodId'
  | 'foodName'
  | 'basisQuantity'
  | 'basisUnit'
  | 'calories'
  | 'protein'
  | 'carbohydrates'
  | 'fat'
  | 'fiber'
  | 'sugar'
  | 'sodium'
  | 'saturatedFat'
  | 'cholesterol'
  | 'potassium'
  | 'calcium'
  | 'iron'
  | 'vitaminC'
  | 'vitaminA';

export type DestinationField =
  | 'entryId'
  | 'date'
  | 'time'
  | 'meal'
  | 'foodId'
  | 'foodName'
  | 'quantity'
  | 'unit'
  | 'calories'
  | 'protein'
  | 'carbohydrates'
  | 'fat'
  | 'fiber'
  | 'notes'
  | 'basisQuantity'
  | 'basisUnit'
  | 'sourceFoodId'
  | 'lastModified';

export interface ColumnMapping {
  /** zero-based column index, or null if unmapped */
  [field: string]: number | null;
}

export interface WorkbookIdentity {
  fileName: string;
  importedAt: string;
  byteLength: number;
  sha256: string;
}

export interface SourceWorkbookConfig {
  identity: WorkbookIdentity;
  worksheetName: string;
  headerRowIndex: number;
  mapping: Partial<Record<SourceField, number | null>>;
  previewHeaders: string[];
}

export interface DestinationWorkbookConfig {
  identity: WorkbookIdentity;
  worksheetName: string;
  headerRowIndex: number;
  mapping: Partial<Record<DestinationField, number | null>>;
  previewHeaders: string[];
  lastVerifiedExportAt: string | null;
  lastBackupAt: string | null;
}

export interface DailyTargets {
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
}

export interface AppSettings {
  targets: DailyTargets;
  selectedDate: string;
  rounding: {
    caloriesDecimals: number;
    macroDecimals: number;
  };
  lastJsonBackupAt: string | null;
  storageWarningAcknowledged: boolean;
}

export interface NutrientValues {
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  saturatedFat: number | null;
  cholesterol: number | null;
  potassium: number | null;
  calcium: number | null;
  iron: number | null;
  vitaminC: number | null;
  vitaminA: number | null;
  [key: string]: number | null;
}

export interface SourceFood {
  foodId: string;
  foodName: string;
  basisQuantity: number;
  basisUnit: string;
  nutrients: NutrientValues;
  rowIndex: number;
  sourceWorksheet: string;
  sourceFileName: string;
}

export interface FoodEntry {
  entryId: string;
  date: string;
  time: string;
  meal: MealCategory;
  sourceFoodId: string;
  sourceFoodName: string;
  quantity: number;
  unit: string;
  basisQuantity: number;
  basisUnit: string;
  nutrients: NutrientValues;
  notes: string;
  sourceWorkbookSha256: string;
  sourceWorksheet: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  syncError: string | null;
  deletedAt: string | null;
  /** Account that created the entry. Missing on records from before login existed. */
  ownerEmail?: string;
}

export interface PendingWrite {
  id: string;
  entryId: string;
  operation: 'upsert' | 'delete';
  createdAt: string;
  lastAttemptAt: string | null;
  attemptCount: number;
  lastError: string | null;
}

export interface RecoveryMeta {
  id: 'primary';
  lastSuccessfulBackupAt: string | null;
  lastVerifiedSaveAt: string | null;
  lastHealthCheckAt: string | null;
  lastHealthCheckOk: boolean;
  notes: string[];
}

export interface StoredBlob {
  id: 'source' | 'destination' | 'destination-recovery';
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  sha256: string;
  savedAt: string;
}

export interface FeatureWarnings {
  hasMacros: boolean;
  hasCharts: boolean;
  hasPivotTables: boolean;
  hasDataValidations: boolean;
  hasExternalLinks: boolean;
  hasDefinedNames: boolean;
  messages: string[];
}

export interface DailyTotals {
  date: string;
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
  sugar: number;
  entryCount: number;
  unknownNutrients: string[];
  byMeal: Record<
    MealCategory,
    {
      calories: number;
      protein: number;
      carbohydrates: number;
      fat: number;
      fiber: number;
      count: number;
    }
  >;
}

export type UserRole = 'admin' | 'member';
export type AccountStatus = 'pending' | 'approved' | 'denied';

export interface Account {
  email: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: 'current';
  email: string;
  createdAt: string;
  /** Google ID token. Sessions without one are ignored. */
  idToken?: string;
  /** Unix seconds, matching the token `exp` claim. */
  expiresAt?: number;
}

export interface GoogleCertCache {
  id: 'jwks';
  fetchedAt: string;
  keys: JsonWebKey[];
}

export interface JsonBackupPayload {
  version: string;
  exportedAt: string;
  settings: AppSettings;
  sourceConfig: SourceWorkbookConfig | null;
  destinationConfig: DestinationWorkbookConfig | null;
  entries: FoodEntry[];
  pendingWrites: PendingWrite[];
  recovery: RecoveryMeta;
  accounts?: Account[];
}

export const SOURCE_FIELD_LABELS: Record<SourceField, string> = {
  foodId: 'Food ID',
  foodName: 'Food Name',
  basisQuantity: 'Basis Quantity',
  basisUnit: 'Basis Unit',
  calories: 'Calories',
  protein: 'Protein',
  carbohydrates: 'Carbohydrates',
  fat: 'Fat',
  fiber: 'Fiber',
  sugar: 'Sugar',
  sodium: 'Sodium',
  saturatedFat: 'Saturated Fat',
  cholesterol: 'Cholesterol',
  potassium: 'Potassium',
  calcium: 'Calcium',
  iron: 'Iron',
  vitaminC: 'Vitamin C',
  vitaminA: 'Vitamin A',
};

export const DESTINATION_FIELD_LABELS: Record<DestinationField, string> = {
  entryId: 'Entry ID',
  date: 'Date',
  time: 'Time',
  meal: 'Meal',
  foodId: 'Food ID',
  foodName: 'Food Name',
  quantity: 'Quantity',
  unit: 'Unit',
  calories: 'Calories',
  protein: 'Protein',
  carbohydrates: 'Carbohydrates',
  fat: 'Fat',
  fiber: 'Fiber',
  notes: 'Notes',
  basisQuantity: 'Basis Quantity',
  basisUnit: 'Basis Unit',
  sourceFoodId: 'Source Food ID',
  lastModified: 'Last Modified',
};

export const DEFAULT_TARGETS: DailyTargets = {
  calories: 2000,
  protein: 150,
  carbohydrates: 200,
  fat: 65,
  fiber: 30,
};

export const DEFAULT_SETTINGS: AppSettings = {
  targets: DEFAULT_TARGETS,
  selectedDate: new Date().toISOString().slice(0, 10),
  rounding: {
    caloriesDecimals: 0,
    macroDecimals: 1,
  },
  lastJsonBackupAt: null,
  storageWarningAcknowledged: false,
};

export const MEAL_LABELS: Record<MealCategory, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  other: 'Other',
};

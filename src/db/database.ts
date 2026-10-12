import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_SETTINGS,
  type AppSettings,
  type DestinationWorkbookConfig,
  type FoodEntry,
  type PendingWrite,
  type RecoveryMeta,
  type SourceWorkbookConfig,
  type StoredBlob,
  type Account,
  type AuthSession,
  type GoogleCertCache,
} from '../types';
import { nowIso } from '../util/hash';

interface MealTrackerDB extends DBSchema {
  settings: {
    key: 'primary';
    value: AppSettings;
  };
  sourceConfig: {
    key: 'primary';
    value: SourceWorkbookConfig;
  };
  destinationConfig: {
    key: 'primary';
    value: DestinationWorkbookConfig;
  };
  entries: {
    key: string;
    value: FoodEntry;
    indexes: { 'by-date': string; 'by-sync': string };
  };
  pendingWrites: {
    key: string;
    value: PendingWrite;
    indexes: { 'by-entry': string };
  };
  blobs: {
    key: string;
    value: StoredBlob;
  };
  recovery: {
    key: 'primary';
    value: RecoveryMeta;
  };
  accounts: {
    key: string;
    value: Account;
  };
  session: {
    key: 'current';
    value: AuthSession;
  };
  googleCerts: {
    key: 'jwks';
    value: GoogleCertCache;
  };
}

let dbPromise: Promise<IDBPDatabase<MealTrackerDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<MealTrackerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MealTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('sourceConfig')) {
          db.createObjectStore('sourceConfig');
        }
        if (!db.objectStoreNames.contains('destinationConfig')) {
          db.createObjectStore('destinationConfig');
        }
        if (!db.objectStoreNames.contains('entries')) {
          const entries = db.createObjectStore('entries', { keyPath: 'entryId' });
          entries.createIndex('by-date', 'date');
          entries.createIndex('by-sync', 'syncStatus');
        }
        if (!db.objectStoreNames.contains('pendingWrites')) {
          const pending = db.createObjectStore('pendingWrites', { keyPath: 'id' });
          pending.createIndex('by-entry', 'entryId');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('recovery')) {
          db.createObjectStore('recovery');
        }
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'email' });
        }
        if (!db.objectStoreNames.contains('session')) {
          db.createObjectStore('session');
        }
        if (!db.objectStoreNames.contains('googleCerts')) {
          db.createObjectStore('googleCerts');
        }
      },
    });
  }
  return dbPromise;
}

/** Test helper: reset the module-level DB promise. */
export function resetDbPromise(): void {
  dbPromise = null;
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const existing = await db.get('settings', 'primary');
  if (!existing) {
    const settings = { ...DEFAULT_SETTINGS, selectedDate: new Date().toISOString().slice(0, 10) };
    await db.put('settings', settings, 'primary');
    return settings;
  }
  return existing;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put('settings', settings, 'primary');
}

export async function getSourceConfig(): Promise<SourceWorkbookConfig | null> {
  const db = await getDb();
  return (await db.get('sourceConfig', 'primary')) ?? null;
}

export async function saveSourceConfig(config: SourceWorkbookConfig): Promise<void> {
  const db = await getDb();
  await db.put('sourceConfig', config, 'primary');
}

export async function getDestinationConfig(): Promise<DestinationWorkbookConfig | null> {
  const db = await getDb();
  return (await db.get('destinationConfig', 'primary')) ?? null;
}

export async function saveDestinationConfig(config: DestinationWorkbookConfig): Promise<void> {
  const db = await getDb();
  await db.put('destinationConfig', config, 'primary');
}

export async function putBlob(blob: StoredBlob): Promise<void> {
  const db = await getDb();
  await db.put('blobs', blob);
}

export async function getBlob(id: StoredBlob['id']): Promise<StoredBlob | undefined> {
  const db = await getDb();
  return db.get('blobs', id);
}

export async function getRecovery(): Promise<RecoveryMeta> {
  const db = await getDb();
  const existing = await db.get('recovery', 'primary');
  if (existing) return existing;
  const meta: RecoveryMeta = {
    id: 'primary',
    lastSuccessfulBackupAt: null,
    lastVerifiedSaveAt: null,
    lastHealthCheckAt: null,
    lastHealthCheckOk: true,
    notes: [],
  };
  await db.put('recovery', meta, 'primary');
  return meta;
}

export async function saveRecovery(meta: RecoveryMeta): Promise<void> {
  const db = await getDb();
  await db.put('recovery', meta, 'primary');
}

export async function upsertEntry(
  entry: FoodEntry,
  pending: PendingWrite | null,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['entries', 'pendingWrites'], 'readwrite');
  await tx.objectStore('entries').put(entry);
  if (pending) {
    await tx.objectStore('pendingWrites').put(pending);
  }
  await tx.done;
}

export async function getEntry(entryId: string): Promise<FoodEntry | undefined> {
  const db = await getDb();
  return db.get('entries', entryId);
}

export async function getEntriesByDate(date: string): Promise<FoodEntry[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('entries', 'by-date', date);
  return all.filter((e) => !e.deletedAt);
}

export async function getAllEntries(includeDeleted = false): Promise<FoodEntry[]> {
  const db = await getDb();
  const all = await db.getAll('entries');
  return includeDeleted ? all : all.filter((e) => !e.deletedAt);
}

export async function softDeleteEntry(
  entryId: string,
  pending: PendingWrite,
): Promise<FoodEntry | undefined> {
  const db = await getDb();
  const tx = db.transaction(['entries', 'pendingWrites'], 'readwrite');
  const existing = await tx.objectStore('entries').get(entryId);
  if (!existing) {
    await tx.abort();
    return undefined;
  }
  const updated: FoodEntry = {
    ...existing,
    deletedAt: nowIso(),
    updatedAt: nowIso(),
    syncStatus: 'pending',
    syncError: null,
  };
  await tx.objectStore('entries').put(updated);
  await tx.objectStore('pendingWrites').put(pending);
  await tx.done;
  return updated;
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  const db = await getDb();
  return db.getAll('pendingWrites');
}

export async function removePendingForEntry(entryId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('pendingWrites', 'readwrite');
  const index = tx.store.index('by-entry');
  let cursor = await index.openCursor(entryId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function putPending(pending: PendingWrite): Promise<void> {
  const db = await getDb();
  await db.put('pendingWrites', pending);
}

export async function getAccount(email: string): Promise<Account | undefined> {
  const db = await getDb();
  return db.get('accounts', email);
}

export async function putAccount(account: Account): Promise<void> {
  const db = await getDb();
  await db.put('accounts', account);
}

export async function getAllAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.getAll('accounts');
}

export async function getAuthSession(): Promise<AuthSession | undefined> {
  const db = await getDb();
  return db.get('session', 'current');
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  const db = await getDb();
  await db.put('session', session, 'current');
}

export async function clearAuthSession(): Promise<void> {
  const db = await getDb();
  await db.delete('session', 'current');
}

export async function getGoogleCertCache(): Promise<GoogleCertCache | undefined> {
  const db = await getDb();
  return db.get('googleCerts', 'jwks');
}

export async function saveGoogleCertCache(cache: GoogleCertCache): Promise<void> {
  const db = await getDb();
  await db.put('googleCerts', cache, 'jwks');
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    [
      'settings',
      'sourceConfig',
      'destinationConfig',
      'entries',
      'pendingWrites',
      'blobs',
      'recovery',
      'accounts',
      'session',
      'googleCerts',
    ],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('settings').clear(),
    tx.objectStore('sourceConfig').clear(),
    tx.objectStore('destinationConfig').clear(),
    tx.objectStore('entries').clear(),
    tx.objectStore('pendingWrites').clear(),
    tx.objectStore('blobs').clear(),
    tx.objectStore('recovery').clear(),
    tx.objectStore('accounts').clear(),
    tx.objectStore('session').clear(),
    tx.objectStore('googleCerts').clear(),
  ]);
  await tx.done;
}

export interface StorageHealth {
  ok: boolean;
  indexedDbAvailable: boolean;
  estimate?: { usage: number; quota: number };
  entryCount: number;
  pendingCount: number;
  hasSource: boolean;
  hasDestination: boolean;
  error?: string;
}

export async function checkStorageHealth(): Promise<StorageHealth> {
  const result: StorageHealth = {
    ok: false,
    indexedDbAvailable: typeof indexedDB !== 'undefined',
    entryCount: 0,
    pendingCount: 0,
    hasSource: false,
    hasDestination: false,
  };

  if (!result.indexedDbAvailable) {
    result.error = 'IndexedDB is not available in this browser.';
    return result;
  }

  try {
    const db = await getDb();
    result.entryCount = (await db.getAll('entries')).filter((e) => !e.deletedAt).length;
    result.pendingCount = (await db.getAll('pendingWrites')).length;
    result.hasSource = Boolean(await db.get('blobs', 'source'));
    result.hasDestination = Boolean(await db.get('blobs', 'destination'));

    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      result.estimate = {
        usage: est.usage ?? 0,
        quota: est.quota ?? 0,
      };
    }

    result.ok = true;
    const recovery = await getRecovery();
    await saveRecovery({
      ...recovery,
      lastHealthCheckAt: nowIso(),
      lastHealthCheckOk: true,
    });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.ok = false;
    try {
      const recovery = await getRecovery();
      await saveRecovery({
        ...recovery,
        lastHealthCheckAt: nowIso(),
        lastHealthCheckOk: false,
        notes: [...recovery.notes, `Health check failed: ${result.error}`].slice(-20),
      });
    } catch {
      // ignore secondary failure
    }
  }

  return result;
}

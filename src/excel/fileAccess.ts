import { getBlob, getDb, putBlob } from '../db/database';
import { downloadBlob, nowIso, sha256Hex } from '../util/hash';

export type WorkbookKind = 'source' | 'destination';

export type PickerStatus = 'file' | 'downloaded' | 'cancelled' | 'unsupported';

export interface PickerOutcome {
  status: PickerStatus;
  file: File | null;
}

const XLSX_TYPE: FilePickerAcceptType = {
  description: 'Excel workbook',
  accept: {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  },
};

function pickerAvailable(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
}

function cancelled(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function rememberHandle(kind: WorkbookKind, handle: FileSystemFileHandle): Promise<void> {
  const db = await getDb();
  await db.put('fileHandles', { id: kind, handle }, kind);
}

export async function forgetFileHandle(kind: WorkbookKind): Promise<void> {
  const db = await getDb();
  await db.delete('fileHandles', kind);
}

export async function getFileHandle(kind: WorkbookKind): Promise<FileSystemFileHandle | null> {
  const db = await getDb();
  const stored = await db.get('fileHandles', kind);
  return stored?.handle ?? null;
}

async function permission(
  handle: FileSystemFileHandle,
  mode: FileSystemPermissionMode,
  request: boolean,
): Promise<boolean> {
  const current = await handle.queryPermission({ mode });
  if (current === 'granted') return true;
  if (!request || current === 'denied') return false;
  const next = await handle.requestPermission({ mode });
  return next === 'granted';
}

const fileQueues: Record<WorkbookKind, Promise<unknown>> = {
  source: Promise.resolve(),
  destination: Promise.resolve(),
};

function queued<T>(kind: WorkbookKind, task: () => Promise<T>): Promise<T> {
  const run = fileQueues[kind].then(task, task);
  fileQueues[kind] = run.catch(() => undefined);
  return run;
}

function fileBusy(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'InvalidStateError' ||
      err.name === 'NotReadableError' ||
      err.name === 'NoModificationAllowedError')
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function busyMessage(kind: WorkbookKind): string {
  return kind === 'source'
    ? 'The nutrition file is busy. Close it in Excel and try again.'
    : 'The meal log file is busy. Close it in Excel and try again.';
}

async function readHandle(
  kind: WorkbookKind,
  handle: FileSystemFileHandle,
): Promise<{ file: File; data: ArrayBuffer }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const file = await handle.getFile();
      return { file, data: await file.arrayBuffer() };
    } catch (err) {
      if (!fileBusy(err)) throw err;
      if (attempt >= 3) throw new Error(busyMessage(kind));
      await wait(200 * (attempt + 1));
    }
  }
}

export function refreshBoundFile(kind: WorkbookKind): Promise<boolean> {
  return queued(kind, () => refreshNow(kind));
}

async function refreshNow(kind: WorkbookKind): Promise<boolean> {
  const handle = await getFileHandle(kind);
  if (!handle) return false;
  const mode: FileSystemPermissionMode = kind === 'destination' ? 'readwrite' : 'read';
  const allowed = await permission(handle, mode, false);
  if (!allowed) return false;
  const { file, data } = await readHandle(kind, handle);
  const sha = await sha256Hex(data);
  const existing = await getBlob(kind);
  if (existing?.sha256 === sha) return false;
  await putBlob({
    id: kind,
    fileName: file.name,
    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data,
    sha256: sha,
    savedAt: nowIso(),
  });
  return true;
}

async function requireWriteAccess(kind: WorkbookKind, handle: FileSystemFileHandle): Promise<void> {
  if (await permission(handle, 'readwrite', true)) return;
  throw new Error(
    kind === 'source'
      ? 'Allow access to the nutrition file to save it.'
      : 'Allow access to the meal log file to save it.',
  );
}

export function writeBoundFile(kind: WorkbookKind, data: ArrayBuffer): Promise<boolean> {
  return queued(kind, () => writeNow(kind, data));
}

async function writeNow(kind: WorkbookKind, data: ArrayBuffer): Promise<boolean> {
  const handle = await getFileHandle(kind);
  if (!handle) return false;
  await requireWriteAccess(kind, handle);
  try {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (err) {
    if (fileBusy(err)) throw new Error(busyMessage(kind));
    throw err;
  }
  return true;
}

export function updateBoundFile(
  kind: WorkbookKind,
  change: (data: ArrayBuffer) => ArrayBuffer,
): Promise<ArrayBuffer | null> {
  return queued(kind, async () => {
    const handle = await getFileHandle(kind);
    if (!handle) return null;
    await requireWriteAccess(kind, handle);
    const { data } = await readHandle(kind, handle);
    const next = change(data);
    await writeNow(kind, next);
    return next;
  });
}

export async function chooseWorkbook(kind: WorkbookKind): Promise<PickerOutcome> {
  if (!pickerAvailable()) return { status: 'unsupported', file: null };
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [XLSX_TYPE],
    });
    if (!handle) return { status: 'cancelled', file: null };
    const mode: FileSystemPermissionMode = 'readwrite';
    await permission(handle, mode, true);
    await rememberHandle(kind, handle);
    return { status: 'file', file: await handle.getFile() };
  } catch (err) {
    if (cancelled(err)) return { status: 'cancelled', file: null };
    throw err;
  }
}

export async function saveSampleWorkbook(
  kind: WorkbookKind,
  fileName: string,
  bytes: ArrayBuffer,
): Promise<PickerOutcome> {
  if (!pickerAvailable()) {
    downloadBlob(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName,
    );
    return { status: 'downloaded', file: null };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [XLSX_TYPE],
    });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    await rememberHandle(kind, handle);
    return { status: 'file', file: await handle.getFile() };
  } catch (err) {
    if (cancelled(err)) return { status: 'cancelled', file: null };
    throw err;
  }
}

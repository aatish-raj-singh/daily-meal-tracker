import { getBlob, getWorkoutConfig, putBlob, saveWorkoutConfig } from '../db/database';
import { refreshBoundFile } from '../excel/fileAccess';
import { requiredWorkoutFieldsMapped } from '../excel/mapping';
import {
  buildDefaultWorkoutConfig,
  exercisesForWeekday,
  importWorkbookFile,
  loadWorkoutExercises,
  readWorkbookFromBuffer,
  weekdayName,
} from '../excel/workbook';
import type { WorkoutExercise, WorkoutWorkbookConfig } from '../types';
import { nowIso } from '../util/hash';

export function workoutPlanIsActive(config: WorkoutWorkbookConfig | null): boolean {
  if (!config) return false;
  if (config.mappingSaved === true) return true;
  if (config.mappingSaved === false) return false;
  return requiredWorkoutFieldsMapped(config.mapping).length === 0;
}

export async function importWorkoutWorkbook(
  file: File,
  worksheetName?: string,
  headerRowIndex = 0,
): Promise<{ config: WorkoutWorkbookConfig; sheetNames: string[] }> {
  const imported = await importWorkbookFile(file);
  const sheet = worksheetName ?? imported.sheetNames[0];
  const config = buildDefaultWorkoutConfig(imported, sheet, headerRowIndex);
  await putBlob({
    id: 'workout',
    fileName: imported.identity.fileName,
    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: imported.data,
    sha256: imported.identity.sha256,
    savedAt: nowIso(),
  });
  await saveWorkoutConfig(config);
  return { config, sheetNames: imported.sheetNames };
}

export async function updateWorkoutMapping(config: WorkoutWorkbookConfig): Promise<void> {
  await saveWorkoutConfig(config);
}

export async function getDaySplit(isoDate: string): Promise<WorkoutExercise[] | null> {
  await refreshBoundFile('workout').catch(() => false);
  const config = await getWorkoutConfig();
  if (!workoutPlanIsActive(config) || !config) return null;
  const blob = await getBlob('workout');
  if (!blob) return null;
  const imported = readWorkbookFromBuffer(blob.data, blob.fileName);
  const rows = loadWorkoutExercises(imported.workbook, config);
  return exercisesForWeekday(rows, weekdayName(isoDate));
}

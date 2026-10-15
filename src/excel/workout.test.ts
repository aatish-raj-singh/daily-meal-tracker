import { describe, expect, it } from 'vitest';
import { buildWorkoutSample } from './samples';
import {
  buildDefaultWorkoutConfig,
  exercisesForWeekday,
  loadWorkoutExercises,
  readWorkbookFromBuffer,
  weekdayName,
} from './workbook';

describe('workout split', () => {
  it('shows only the selected weekday', () => {
    const data = buildWorkoutSample();
    const imported = readWorkbookFromBuffer(data, 'workout-plan.xlsx');
    const config = buildDefaultWorkoutConfig(imported, 'Plan', 0);
    const rows = loadWorkoutExercises(imported.workbook, config);
    const monday = exercisesForWeekday(rows, 'Monday');
    expect(monday.map((row) => row.exercise)).toEqual(['Bench Press', 'Overhead Press', 'Lateral Raise']);
    expect(exercisesForWeekday(rows, 'Sunday')).toEqual([]);
    expect(exercisesForWeekday(rows, 'Tuesday').some((row) => row.exercise === 'Bench Press')).toBe(false);
  });

  it('uses the calendar weekday of the selected date', () => {
    expect(weekdayName('2026-10-19')).toBe('Monday');
    expect(weekdayName('2026-10-15')).toBe('Thursday');
  });
});

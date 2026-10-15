import type { FoodEntry, MealCategory, SourceFood, SyncStatus } from '../types';

export type TabId = 'dashboard' | 'log' | 'history' | 'excel' | 'settings' | 'admin' | 'breakdown';

export interface UiState {
  tab: TabId;
  banner: { type: 'info' | 'success' | 'warning' | 'error'; text: string } | null;
  selectedFood: SourceFood | null;
  editingEntry: FoodEntry | null;
  logMeal: MealCategory | null;
  offline: boolean;
}

export const uiState: UiState = {
  tab: 'dashboard',
  banner: null,
  selectedFood: null,
  editingEntry: null,
  logMeal: null,
  offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
};

export function setBanner(
  type: NonNullable<UiState['banner']>['type'],
  text: string,
): void {
  uiState.banner = { type, text };
}

export function clearBanner(): void {
  uiState.banner = null;
}

export function saveStatusNote(status: SyncStatus): string {
  switch (status) {
    case 'synced':
      return '';
    case 'pending':
    case 'local_only':
      return 'waiting to save';
    case 'failed':
      return 'couldn’t save';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

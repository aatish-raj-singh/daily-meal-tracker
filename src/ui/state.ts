import type { FoodEntry, SourceFood } from '../types';

export type TabId = 'dashboard' | 'log' | 'history' | 'excel' | 'settings' | 'admin';

export interface UiState {
  tab: TabId;
  banner: { type: 'info' | 'success' | 'warning' | 'error'; text: string } | null;
  selectedFood: SourceFood | null;
  editingEntry: FoodEntry | null;
  offline: boolean;
}

export const uiState: UiState = {
  tab: 'dashboard',
  banner: null,
  selectedFood: null,
  editingEntry: null,
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

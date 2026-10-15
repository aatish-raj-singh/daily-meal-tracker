import { deleteFoodEntry, getCachedSourceFoods, listHistory } from '../services/foodLog';
import { MEAL_LABELS, type FoodEntry, type MealCategory } from '../types';
import { escapeHtml, formatNumber, todayLocal } from '../util/hash';
import { saveStatusNote, setBanner, uiState } from './state';

type HistoryMeal = MealCategory | 'all';

export interface HistoryDay {
  date: string;
  entries: FoodEntry[];
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
}

export function isValidHistoryRange(dateFrom: string, dateTo: string): boolean {
  return Boolean(dateFrom && dateTo && dateTo >= dateFrom);
}

export function groupHistory(entries: FoodEntry[]): HistoryDay[] {
  const groups = new Map<string, FoodEntry[]>();
  for (const entry of entries) {
    const day = groups.get(entry.date) ?? [];
    day.push(entry);
    groups.set(entry.date, day);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayEntries]) => ({
      date,
      entries: [...dayEntries].sort((a, b) => b.time.localeCompare(a.time)),
      calories: sumNutrient(dayEntries, 'calories'),
      protein: sumNutrient(dayEntries, 'protein'),
      carbohydrates: sumNutrient(dayEntries, 'carbohydrates'),
      fat: sumNutrient(dayEntries, 'fat'),
      fiber: sumNutrient(dayEntries, 'fiber'),
    }));
}

export async function renderHistory(root: HTMLElement): Promise<void> {
  const today = todayLocal();
  const dateFrom = root.dataset.dateFrom || today;
  const dateTo = root.dataset.dateTo || today;
  const meal = selectedMeal(root.dataset.meal);
  const filters = { dateFrom, dateTo, meal };

  if (!isValidHistoryRange(dateFrom, dateTo)) {
    paint(root, filters, { kind: 'invalid' });
    bind(root, today);
    return;
  }

  paint(root, filters, { kind: 'loading' });
  try {
    const entries = await listHistory({ dateFrom, dateTo, meal });
    renderedEntries.set(root, entries);
    paint(root, filters, { kind: 'ready', days: groupHistory(entries) });
  } catch (err) {
    paint(root, filters, {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Couldn’t load history.',
    });
  }
  bind(root, today);
}

function paint(
  root: HTMLElement,
  filters: { dateFrom: string; dateTo: string; meal: HistoryMeal },
  state:
    | { kind: 'loading' }
    | { kind: 'invalid' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; days: HistoryDay[] },
): void {
  root.innerHTML = `
    <section class="history-heading">
      <h2>History</h2>
      <p>Review your meals and nutrition</p>
    </section>
    ${filterCard(filters, state.kind === 'invalid')}
    ${resultsMarkup(filters, state)}
  `;
}

function resultsMarkup(
  filters: { meal: HistoryMeal },
  state:
    | { kind: 'loading' }
    | { kind: 'invalid' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; days: HistoryDay[] },
): string {
  switch (state.kind) {
    case 'loading':
      return `<div class="history-status" role="status">Loading history…</div>`;
    case 'invalid':
      return '';
    case 'error':
      return `<div class="banner error" role="alert">${escapeHtml(state.message)}</div>`;
    case 'ready':
      return state.days.length
        ? state.days.map((day, index) => dayGroup(day, index === 0)).join('')
        : emptyHistory(filters.meal);
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function filterCard(
  filters: { dateFrom: string; dateTo: string; meal: HistoryMeal },
  invalid: boolean,
): string {
  return `
    <section class="card history-filters">
      <div class="grid-2">
        <div class="field">
          <label for="hist-from">From</label>
          <input id="hist-from" type="date" value="${escapeHtml(filters.dateFrom)}" />
        </div>
        <div class="field">
          <label for="hist-to">To</label>
          <input id="hist-to" type="date" value="${escapeHtml(filters.dateTo)}" />
        </div>
      </div>
      <div class="field">
        <label for="hist-meal">Meal</label>
        <select id="hist-meal">
          <option value="all" ${filters.meal === 'all' ? 'selected' : ''}>All meals</option>
          ${(Object.keys(MEAL_LABELS) as MealCategory[])
            .map(
              (meal) =>
                `<option value="${meal}" ${filters.meal === meal ? 'selected' : ''}>${MEAL_LABELS[meal]}</option>`,
            )
            .join('')}
        </select>
      </div>
      <button type="button" class="ghost" id="hist-clear">Clear filters</button>
      ${invalid ? `<p class="banner error" role="alert">The end date must be on or after the start date.</p>` : ''}
    </section>`;
}

function dayGroup(day: HistoryDay, open: boolean): string {
  const count = day.entries.length;
  return `
    <details class="card history-day" ${open ? 'open' : ''}>
      <summary>
        <span>
          <strong>${escapeHtml(formatHistoryDate(day.date))}</strong>
          <span class="meta">${count} ${count === 1 ? 'entry' : 'entries'}</span>
        </span>
        <span class="history-nuts">
          <span class="n-calories">${formatNumber(day.calories, 0)} kcal</span>
          <span class="n-protein">P ${formatNumber(day.protein, 1)}</span>
          <span class="n-carbs">C ${formatNumber(day.carbohydrates, 1)}</span>
          <span class="n-fat">F ${formatNumber(day.fat, 1)}</span>
          <span class="n-fiber">Fiber ${formatNumber(day.fiber, 1)}</span>
        </span>
      </summary>
      <div class="list">${day.entries.map((entry) => entryCard(entry)).join('')}</div>
    </details>`;
}

function entryCard(entry: FoodEntry): string {
  const fiber =
    entry.nutrients.fiber === null
      ? ''
      : `<span class="n-fiber">Fiber ${formatNumber(entry.nutrients.fiber, 1)}</span>`;
  return `
    <article class="history-entry">
      <div class="food-main">
        <div class="title">${escapeHtml(entry.sourceFoodName)} <span class="meal-chip">${MEAL_LABELS[entry.meal]}</span></div>
        <div class="food-kcal">${formatNumber(entry.nutrients.calories, 0)} kcal</div>
      </div>
      <div class="meta">${escapeHtml(entry.time)} · ${entry.quantity} ${escapeHtml(entry.unit)}</div>
      <div class="history-nuts">
        <span class="n-protein">P ${formatNumber(entry.nutrients.protein, 1)}</span>
        <span class="n-carbs">C ${formatNumber(entry.nutrients.carbohydrates, 1)}</span>
        <span class="n-fat">F ${formatNumber(entry.nutrients.fat, 1)}</span>
        ${fiber}
      </div>
      ${statusLine(entry)}
      <div class="btn-row">
        <button type="button" class="secondary edit-btn" data-id="${escapeHtml(entry.entryId)}">Edit</button>
        <button type="button" class="danger delete-btn" data-id="${escapeHtml(entry.entryId)}">Delete</button>
      </div>
    </article>`;
}

function emptyHistory(meal: HistoryMeal): string {
  const message =
    meal === 'all' ? 'No meals found for this period.' : 'No meals found for this meal.';
  return `
    <section class="card history-empty">
      <h2>${escapeHtml(message)}</h2>
      <div class="btn-row">
        <button type="button" class="ghost" id="hist-reset">Reset filters</button>
        <button type="button" class="primary" id="hist-log">Log food</button>
      </div>
    </section>`;
}

function bind(root: HTMLElement, today: string): void {
  const apply = () => {
    root.dataset.dateFrom = (root.querySelector('#hist-from') as HTMLInputElement).value;
    root.dataset.dateTo = (root.querySelector('#hist-to') as HTMLInputElement).value;
    root.dataset.meal = (root.querySelector('#hist-meal') as HTMLSelectElement).value;
    void renderHistory(root);
  };
  const reset = () => {
    root.dataset.dateFrom = today;
    root.dataset.dateTo = today;
    root.dataset.meal = 'all';
    void renderHistory(root);
  };

  root.querySelector('#hist-from')?.addEventListener('change', apply);
  root.querySelector('#hist-to')?.addEventListener('change', apply);
  root.querySelector('#hist-meal')?.addEventListener('change', apply);
  root.querySelector('#hist-clear')?.addEventListener('click', reset);
  root.querySelector('#hist-reset')?.addEventListener('click', reset);
  root.querySelector('#hist-log')?.addEventListener('click', () => {
    uiState.editingEntry = null;
    uiState.selectedFood = null;
    uiState.logMeal = null;
    window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'log' }));
  });

  root.querySelectorAll<HTMLButtonElement>('.edit-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const entry = findRenderedEntry(root, button.dataset.id);
      if (entry) await beginEditEntry(entry);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('.delete-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const entry = findRenderedEntry(root, button.dataset.id);
      if (entry) await confirmDeleteEntry(entry);
    });
  });
}

const renderedEntries = new WeakMap<HTMLElement, FoodEntry[]>();

function findRenderedEntry(root: HTMLElement, id: string | undefined): FoodEntry | undefined {
  return renderedEntries.get(root)?.find((entry) => entry.entryId === id);
}

function statusLine(entry: FoodEntry): string {
  const parts = [saveStatusNote(entry.syncStatus), entry.syncError].filter(
    (part): part is string => Boolean(part),
  );
  if (parts.length === 0) return '';
  return `<div class="meta">${parts.map((part) => escapeHtml(part)).join(' · ')}</div>`;
}

export async function beginEditEntry(entry: FoodEntry): Promise<void> {
  const foods = await getCachedSourceFoods();
  const match =
    foods.find((food) => food.foodId === entry.sourceFoodId) ??
    foods.find((food) => food.foodName.toLowerCase() === entry.sourceFoodName.toLowerCase()) ??
    null;
  if (!match) {
    setBanner(
      'error',
      'This food is no longer in your food list. Add the spreadsheet again, then edit.',
    );
    window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    return;
  }
  uiState.editingEntry = entry;
  uiState.selectedFood = match;
  uiState.logMeal = null;
  uiState.tab = 'log';
  window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'log' }));
}

export async function confirmDeleteEntry(entry: FoodEntry): Promise<void> {
  const ok = window.confirm(`Delete ${entry.sourceFoodName} from ${entry.date}?`);
  if (!ok) return;
  try {
    const result = await deleteFoodEntry(entry.entryId);
    setBanner(result.workbookSynced ? 'success' : 'warning', result.message);
    window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
  } catch (err) {
    setBanner('error', err instanceof Error ? err.message : String(err));
    window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
  }
}

function selectedMeal(value: string | undefined): HistoryMeal {
  switch (value) {
    case 'breakfast':
    case 'lunch':
    case 'dinner':
    case 'snack':
    case 'other':
    case 'all':
      return value;
    default:
      return 'all';
  }
}

function sumNutrient(
  entries: FoodEntry[],
  key: 'calories' | 'protein' | 'carbohydrates' | 'fat' | 'fiber',
): number {
  return entries.reduce((sum, entry) => sum + (entry.nutrients[key] ?? 0), 0);
}

function formatHistoryDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year || 0, (month || 1) - 1, day || 1);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

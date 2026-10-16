import { getSettings, saveSettings } from '../db/database';
import { compatibleUnitsFor } from '../nutrition/units';
import {
  copyLineFromEntry,
  copyLineFromFood,
  draftFromLine,
  entriesForMeal,
  lineNutrients,
  visibleEntriesOnDate,
  yesterdayLocal,
  type CopyLine,
} from '../services/copyMeal';
import { getCachedSourceFoods, saveCopiedEntries } from '../services/foodLog';
import { MEAL_LABELS, type MealCategory, type SourceFood } from '../types';
import { escapeHtml, formatNumber } from '../util/hash';
import { setBanner, uiState } from './state';

type CopyMode = 'home' | 'choose' | 'preview';

interface CopyView {
  mode: CopyMode;
  sourceDate: string;
  sourceMeal: MealCategory;
  destinationDate: string;
  destinationMeal: MealCategory;
  lines: CopyLine[];
  error: string;
  saving: boolean;
}

const view: CopyView = {
  mode: 'home',
  sourceDate: '',
  sourceMeal: 'breakfast',
  destinationDate: '',
  destinationMeal: 'breakfast',
  lines: [],
  error: '',
  saving: false,
};

export async function renderCopyMeal(host: HTMLElement): Promise<void> {
  if (!view.sourceDate) view.sourceDate = yesterdayLocal();
  const settings = await getSettings();
  const foods = await getCachedSourceFoods();
  const yesterday = yesterdayLocal();
  const yesterdayBreakfast = await entriesForMeal(yesterday, 'breakfast');

  const formDate = (host.parentElement?.querySelector('#log-date') as HTMLInputElement | null)?.value;
  const selectedDate = formDate || settings.selectedDate;
  if (view.mode === 'home') {
    host.innerHTML = homeMarkup(yesterday, yesterdayBreakfast.length);
  } else if (view.mode === 'choose') {
    const entries = view.sourceDate ? await entriesForMeal(view.sourceDate, view.sourceMeal) : [];
    host.innerHTML = chooseMarkup(entries);
  } else {
    const already = view.destinationDate ? await visibleEntriesOnDate(view.destinationDate) : [];
    host.innerHTML = previewMarkup(foods, settings.rounding, already.length);
  }
  bind(host, foods, settings.rounding, selectedDate);
}

function homeMarkup(yesterday: string, breakfastCount: number): string {
  const shortcut =
    breakfastCount > 0
      ? `<button type="button" class="secondary copy-wide" id="copy-yesterday">Copy yesterday’s breakfast</button>
         <p class="muted">${escapeHtml(formatCopyDate(yesterday))} · ${breakfastCount} ${breakfastCount === 1 ? 'food' : 'foods'}</p>`
      : '';
  return `
    <section class="card copy-meal">
      <h2>Copy a meal</h2>
      ${errorBanner()}
      ${shortcut}
      <button type="button" class="secondary copy-wide" id="copy-choose">Choose a previous meal</button>
    </section>
  `;
}

function chooseMarkup(entries: Array<{ sourceFoodName: string; quantity: number; unit: string }>): string {
  const list = entries.length
    ? `<ul class="copy-source-list">${entries
        .map(
          (entry) =>
            `<li>${escapeHtml(entry.sourceFoodName)} · ${escapeHtml(String(entry.quantity))} ${escapeHtml(entry.unit)}</li>`,
        )
        .join('')}</ul>`
    : `<p class="copy-empty">No foods logged for this meal.</p>`;
  return `
    <section class="card copy-meal">
      <h2>Choose a meal</h2>
      ${errorBanner()}
      <div class="grid-2">
        <div class="field">
          <label for="copy-source-date">Date</label>
          <input id="copy-source-date" type="date" value="${escapeHtml(view.sourceDate)}" />
        </div>
        <div class="field">
          <label for="copy-source-meal">Meal</label>
          ${mealSelect('copy-source-meal', view.sourceMeal)}
        </div>
      </div>
      ${list}
      <div class="btn-row">
        <button type="button" class="primary" id="copy-review" ${entries.length ? '' : 'disabled'}>Review meal</button>
        <button type="button" class="ghost" id="copy-back">Back</button>
      </div>
    </section>
  `;
}

function previewMarkup(
  foods: SourceFood[],
  rounding: { caloriesDecimals: number; macroDecimals: number },
  existingCount: number,
): string {
  const prepared = view.lines.map((line) => ({ line, nutrition: lineNutrients(line, foods, rounding) }));
  const blocked = prepared.some((item) => item.nutrition.error || !(item.line.quantity > 0));
  const totals = sumPreview(prepared.map((item) => item.nutrition.nutrients));
  const lines = prepared
    .map(({ line, nutrition }) => {
      const units = unitChoices(line);
      return `
        <article class="copy-line">
          <div class="copy-line-top">
            <strong>${escapeHtml(line.sourceFoodName)}</strong>
            <button type="button" class="ghost copy-remove" data-id="${escapeHtml(line.entryId)}">Remove</button>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="qty-${escapeHtml(line.entryId)}">Weight</label>
              <input id="qty-${escapeHtml(line.entryId)}" class="copy-qty" data-id="${escapeHtml(line.entryId)}" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(String(line.quantity))}" />
            </div>
            <div class="field">
              <label for="unit-${escapeHtml(line.entryId)}">Unit</label>
              <select id="unit-${escapeHtml(line.entryId)}" class="copy-unit" data-id="${escapeHtml(line.entryId)}">
                ${units
                  .map(
                    (unit) =>
                      `<option value="${escapeHtml(unit)}" ${unit === line.unit ? 'selected' : ''}>${escapeHtml(unit)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
          </div>
          <p class="copy-nuts">
            <span class="n-calories">${escapeHtml(formatNutrient(nutrition.nutrients.calories, 0))} kcal</span>
            <span class="n-protein">P ${escapeHtml(formatNutrient(nutrition.nutrients.protein, 1))}</span>
            <span class="n-carbs">C ${escapeHtml(formatNutrient(nutrition.nutrients.carbohydrates, 1))}</span>
            <span class="n-fat">F ${escapeHtml(formatNutrient(nutrition.nutrients.fat, 1))}</span>
            <span class="n-fiber">Fiber ${escapeHtml(formatNutrient(nutrition.nutrients.fiber, 1))}</span>
          </p>
          ${nutrition.review ? '<p class="copy-review">Not in the food list. Check this amount.</p>' : ''}
          ${nutrition.error ? `<p class="banner error">${escapeHtml(nutrition.error)}</p>` : ''}
        </article>
      `;
    })
    .join('');
  const addFood = foods.length
    ? `<div class="field">
        <label for="copy-food-search">Add a food</label>
        <input id="copy-food-search" type="search" placeholder="Search" />
      </div>
      <div id="copy-food-results" class="search-results" role="listbox" aria-label="Food matches"></div>`
    : '';
  return `
    <section class="card copy-meal" aria-busy="${view.saving ? 'true' : 'false'}">
      <h2>Review copy</h2>
      <p class="muted">From ${escapeHtml(formatCopyDate(view.sourceDate))} · ${escapeHtml(MEAL_LABELS[view.sourceMeal])}</p>
      ${errorBanner()}
      <div class="grid-2">
        <div class="field">
          <label for="copy-dest-date">Date</label>
          <input id="copy-dest-date" type="date" value="${escapeHtml(view.destinationDate)}" />
        </div>
        <div class="field">
          <label for="copy-dest-meal">Meal</label>
          ${mealSelect('copy-dest-meal', view.destinationMeal)}
        </div>
      </div>
      ${existingCount > 0 ? '<p class="muted">This day already has meals. These foods will be added.</p>' : ''}
      <div class="copy-lines">${lines || '<p class="copy-empty">No foods left in this copy.</p>'}</div>
      ${addFood}
      <p class="copy-nuts copy-totals">
        <span class="n-calories">${escapeHtml(formatNutrient(totals.calories, 0))} kcal</span>
        <span class="n-protein">P ${escapeHtml(formatNutrient(totals.protein, 1))}</span>
        <span class="n-carbs">C ${escapeHtml(formatNutrient(totals.carbohydrates, 1))}</span>
        <span class="n-fat">F ${escapeHtml(formatNutrient(totals.fat, 1))}</span>
        <span class="n-fiber">Fiber ${escapeHtml(formatNutrient(totals.fiber, 1))}</span>
      </p>
      <div class="btn-row">
        <button type="button" class="primary" id="copy-save" ${view.saving || blocked || view.lines.length === 0 ? 'disabled' : ''}>${view.saving ? 'Copying…' : 'Copy meal'}</button>
        <button type="button" class="ghost" id="copy-cancel" ${view.saving ? 'disabled' : ''}>Cancel</button>
      </div>
    </section>
  `;
}

function bind(
  host: HTMLElement,
  foods: SourceFood[],
  rounding: { caloriesDecimals: number; macroDecimals: number },
  selectedDate: string,
): void {
  host.querySelector('#copy-yesterday')?.addEventListener('click', () => {
    void openPreview(host, foods, yesterdayLocal(), 'breakfast', selectedDate);
  });
  host.querySelector('#copy-choose')?.addEventListener('click', () => {
    view.mode = 'choose';
    view.error = '';
    void renderCopyMeal(host);
  });
  host.querySelector('#copy-back')?.addEventListener('click', () => {
    resetCopy();
    void renderCopyMeal(host);
  });
  host.querySelector('#copy-source-date')?.addEventListener('change', (event) => {
    view.sourceDate = (event.target as HTMLInputElement).value;
    view.error = '';
    void renderCopyMeal(host);
  });
  host.querySelector('#copy-source-meal')?.addEventListener('change', (event) => {
    view.sourceMeal = mealValue((event.target as HTMLSelectElement).value);
    view.error = '';
    void renderCopyMeal(host);
  });
  host.querySelector('#copy-review')?.addEventListener('click', () => {
    void openPreview(host, foods, view.sourceDate, view.sourceMeal, selectedDate);
  });
  host.querySelector('#copy-cancel')?.addEventListener('click', () => {
    if (view.saving) return;
    resetCopy();
    void renderCopyMeal(host);
  });
  host.querySelector('#copy-dest-date')?.addEventListener('change', (event) => {
    view.destinationDate = (event.target as HTMLInputElement).value;
    void renderCopyMeal(host);
  });
  host.querySelector('#copy-dest-meal')?.addEventListener('change', (event) => {
    view.destinationMeal = mealValue((event.target as HTMLSelectElement).value);
    void renderCopyMeal(host);
  });
  host.querySelectorAll('.copy-qty').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.getAttribute('data-id');
      const line = view.lines.find((item) => item.entryId === id);
      if (!line) return;
      line.quantity = Number((input as HTMLInputElement).value);
      void renderCopyMeal(host);
    });
  });
  host.querySelectorAll('.copy-unit').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.getAttribute('data-id');
      const line = view.lines.find((item) => item.entryId === id);
      if (!line) return;
      line.unit = (input as HTMLSelectElement).value;
      void renderCopyMeal(host);
    });
  });
  host.querySelectorAll('.copy-remove').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-id');
      view.lines = view.lines.filter((line) => line.entryId !== id);
      void renderCopyMeal(host);
    });
  });
  const search = host.querySelector('#copy-food-search') as HTMLInputElement | null;
  const results = host.querySelector('#copy-food-results') as HTMLElement | null;
  if (search && results) {
    const showMatches = () => {
      const query = search.value.trim().toLowerCase();
      const matches = foods
        .filter((food) => !query || food.foodName.toLowerCase().includes(query))
        .slice(0, 12);
      results.innerHTML = matches
        .map(
          (food) =>
            `<button type="button" data-id="${escapeHtml(food.foodId)}" data-row="${food.rowIndex}"><strong>${escapeHtml(food.foodName)}</strong></button>`,
        )
        .join('');
      results.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          const food = foods.find(
            (item) =>
              item.foodId === button.getAttribute('data-id') &&
              item.rowIndex === Number(button.getAttribute('data-row')),
          );
          if (!food) return;
          try {
            const unit = compatibleUnitsFor(food.basisUnit).includes(food.basisUnit)
              ? food.basisUnit
              : (compatibleUnitsFor(food.basisUnit)[0] ?? food.basisUnit);
            view.lines.push(copyLineFromFood(food, food.basisQuantity > 0 ? food.basisQuantity : 100, unit, rounding));
            view.error = '';
          } catch (err) {
            view.error = err instanceof Error ? err.message : String(err);
          }
          void renderCopyMeal(host);
        });
      });
    };
    search.addEventListener('input', showMatches);
  }
  host.querySelector('#copy-save')?.addEventListener('click', () => {
    void commitCopy(host, foods, rounding);
  });
}

async function openPreview(
  host: HTMLElement,
  foods: SourceFood[],
  date: string,
  meal: MealCategory,
  selectedDate: string,
): Promise<void> {
  const entries = await entriesForMeal(date, meal);
  if (entries.length === 0) {
    view.mode = 'choose';
    view.sourceDate = date;
    view.sourceMeal = meal;
    view.error = 'No foods logged for this meal.';
    await renderCopyMeal(host);
    return;
  }
  view.mode = 'preview';
  view.sourceDate = date;
  view.sourceMeal = meal;
  view.destinationDate = selectedDate || date;
  view.destinationMeal = meal;
  view.lines = entries.map((entry) => copyLineFromEntry(entry, foods));
  view.error = '';
  view.saving = false;
  await renderCopyMeal(host);
  (host.querySelector('#copy-dest-date') as HTMLElement | null)?.focus();
}

function readPreviewFields(host: HTMLElement): void {
  host.querySelectorAll<HTMLInputElement>('.copy-qty').forEach((input) => {
    const line = view.lines.find((item) => item.entryId === input.dataset.id);
    if (line) line.quantity = Number(input.value);
  });
  host.querySelectorAll<HTMLSelectElement>('.copy-unit').forEach((input) => {
    const line = view.lines.find((item) => item.entryId === input.dataset.id);
    if (line) line.unit = input.value;
  });
  const date = host.querySelector('#copy-dest-date') as HTMLInputElement | null;
  const meal = host.querySelector('#copy-dest-meal') as HTMLSelectElement | null;
  if (date) view.destinationDate = date.value;
  if (meal) view.destinationMeal = mealValue(meal.value);
}

async function commitCopy(
  host: HTMLElement,
  foods: SourceFood[],
  rounding: { caloriesDecimals: number; macroDecimals: number },
): Promise<void> {
  if (view.saving) return;
  readPreviewFields(host);
  if (!view.destinationDate) {
    view.error = 'Enter a date.';
    await renderCopyMeal(host);
    return;
  }
  const prepared = view.lines.map((line) => ({ line, nutrition: lineNutrients(line, foods, rounding) }));
  const problem = prepared.find((item) => item.nutrition.error || !(item.line.quantity > 0));
  if (problem) {
    view.error = problem.nutrition.error ?? `Enter a weight for ${problem.line.sourceFoodName}.`;
    await renderCopyMeal(host);
    return;
  }
  view.saving = true;
  view.error = '';
  await renderCopyMeal(host);
  try {
    const drafts = prepared.map((item) =>
      draftFromLine(item.line, view.destinationDate, view.destinationMeal, item.nutrition.nutrients),
    );
    const result = await saveCopiedEntries(drafts);
    const settings = await getSettings();
    settings.selectedDate = result.date;
    await saveSettings(settings);
    setBanner(result.workbookSynced ? 'success' : 'warning', result.message);
    resetCopy();
    uiState.tab = 'dashboard';
    window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'dashboard' }));
    window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
  } catch (err) {
    view.saving = false;
    view.error = err instanceof Error ? err.message : String(err);
    await renderCopyMeal(host);
  }
}

function resetCopy(): void {
  view.mode = 'home';
  view.lines = [];
  view.error = '';
  view.saving = false;
  view.destinationDate = '';
}

function errorBanner(): string {
  return view.error ? `<p class="banner error" role="alert">${escapeHtml(view.error)}</p>` : '';
}

function mealSelect(id: string, selected: MealCategory): string {
  const options = (Object.keys(MEAL_LABELS) as MealCategory[])
    .map(
      (meal) =>
        `<option value="${meal}" ${meal === selected ? 'selected' : ''}>${MEAL_LABELS[meal]}</option>`,
    )
    .join('');
  return `<select id="${id}">${options}</select>`;
}

function mealValue(value: string): MealCategory {
  switch (value) {
    case 'breakfast':
    case 'lunch':
    case 'dinner':
    case 'snack':
    case 'other':
      return value;
    default:
      return 'breakfast';
  }
}

function unitChoices(line: CopyLine): string[] {
  const choices = compatibleUnitsFor(line.basisUnit || line.originalUnit);
  return choices.includes(line.unit) ? choices : [line.unit, ...choices];
}

function formatCopyDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatNutrient(value: number | null, decimals: number): string {
  return value === null ? '—' : formatNumber(value, decimals);
}

function sumPreview(rows: Array<{ calories: number | null; protein: number | null; carbohydrates: number | null; fat: number | null; fiber: number | null }>): {
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  fiber: number;
} {
  const total = { calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0 };
  for (const row of rows) {
    total.calories += row.calories ?? 0;
    total.protein += row.protein ?? 0;
    total.carbohydrates += row.carbohydrates ?? 0;
    total.fat += row.fat ?? 0;
    total.fiber += row.fiber ?? 0;
  }
  return total;
}

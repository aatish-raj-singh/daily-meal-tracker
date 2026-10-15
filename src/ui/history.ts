import {
  deleteFoodEntry,
  getCachedSourceFoods,
  listHistory,
} from '../services/foodLog';
import { MEAL_LABELS, type FoodEntry, type MealCategory } from '../types';
import { escapeHtml, formatNumber, todayLocal } from '../util/hash';
import { saveStatusNote, setBanner, uiState } from './state';

function statusLine(entry: FoodEntry): string {
  const parts = [saveStatusNote(entry.syncStatus), entry.syncError].filter(
    (part): part is string => Boolean(part),
  );
  if (parts.length === 0) return '';
  return `<div class="meta">${parts.map((part) => escapeHtml(part)).join(' · ')}</div>`;
}

export async function renderHistory(root: HTMLElement): Promise<void> {
  const today = todayLocal();
  const dateFrom = (root.dataset.dateFrom as string | undefined) ?? today;
  const dateTo = (root.dataset.dateTo as string | undefined) ?? today;
  const meal = (root.dataset.meal as MealCategory | 'all' | undefined) ?? 'all';

  const entries = await listHistory({ dateFrom, dateTo, meal });

  // Group by date
  const byDate = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  root.innerHTML = `
    <div class="card">
      <h2>History</h2>
      <div class="grid-2">
        <div class="field">
          <label for="hist-from">From</label>
          <input id="hist-from" type="date" value="${escapeHtml(dateFrom)}" />
        </div>
        <div class="field">
          <label for="hist-to">To</label>
          <input id="hist-to" type="date" value="${escapeHtml(dateTo)}" />
        </div>
      </div>
      <div class="field">
        <label for="hist-meal">Meal</label>
        <select id="hist-meal">
          <option value="all" ${meal === 'all' ? 'selected' : ''}>All meals</option>
          ${(Object.keys(MEAL_LABELS) as MealCategory[])
            .map(
              (m) =>
                `<option value="${m}" ${meal === m ? 'selected' : ''}>${MEAL_LABELS[m]}</option>`,
            )
            .join('')}
        </select>
      </div>
    </div>

    ${
      byDate.size === 0
        ? ''
        : [...byDate.entries()]
            .map(([date, dayEntries]) => {
              const cal = dayEntries.reduce((s, e) => s + (e.nutrients.calories ?? 0), 0);
              return `
              <div class="card">
                <h3>${escapeHtml(date)} · ${formatNumber(cal, 0)} kcal · ${dayEntries.length} item(s)</h3>
                <div class="list">
                  ${dayEntries
                    .map(
                      (e) => `
                    <div class="list-item" data-id="${escapeHtml(e.entryId)}">
                      <div class="title">${escapeHtml(e.sourceFoodName)} <span class="meal-chip">${MEAL_LABELS[e.meal]}</span></div>
                      <div class="meta">
                        ${e.time} · ${e.quantity} ${escapeHtml(e.unit)} ·
                        ${formatNumber(e.nutrients.calories, 0)} kcal ·
                        P ${formatNumber(e.nutrients.protein, 1)} ·
                        C ${formatNumber(e.nutrients.carbohydrates, 1)} ·
                        F ${formatNumber(e.nutrients.fat, 1)}
                      </div>
                      ${statusLine(e)}
                      <div class="btn-row">
                        <button class="secondary edit-btn" data-id="${escapeHtml(e.entryId)}">Edit</button>
                        <button class="danger delete-btn" data-id="${escapeHtml(e.entryId)}">Delete</button>
                      </div>
                    </div>`,
                    )
                    .join('')}
                </div>
              </div>`;
            })
            .join('')
    }
  `;

  const refresh = () => {
    root.dataset.dateFrom = (root.querySelector('#hist-from') as HTMLInputElement).value;
    root.dataset.dateTo = (root.querySelector('#hist-to') as HTMLInputElement).value;
    root.dataset.meal = (root.querySelector('#hist-meal') as HTMLSelectElement).value;
    void renderHistory(root);
  };

  root.querySelector('#hist-from')?.addEventListener('change', refresh);
  root.querySelector('#hist-to')?.addEventListener('change', refresh);
  root.querySelector('#hist-meal')?.addEventListener('change', refresh);

  root.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')!;
      const entry = entries.find((e) => e.entryId === id);
      if (!entry) return;
      const foods = await getCachedSourceFoods();
      const match =
        foods.find((f) => f.foodId === entry.sourceFoodId) ??
        foods.find((f) => f.foodName.toLowerCase() === entry.sourceFoodName.toLowerCase()) ??
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
      uiState.tab = 'log';
      window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'log' }));
    });
  });

  root.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')!;
      const entry = entries.find((e) => e.entryId === id);
      if (!entry) return;
      const ok = window.confirm(
        `Delete ${entry.sourceFoodName} from ${entry.date}?`,
      );
      if (!ok) return;
      try {
        const result = await deleteFoodEntry(id);
        setBanner(result.workbookSynced ? 'success' : 'warning', result.message);
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      } catch (err) {
        setBanner('error', err instanceof Error ? err.message : String(err));
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      }
    });
  });
}

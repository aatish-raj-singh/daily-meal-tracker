import { getSettings, saveSettings } from '../db/database';
import { calculateNutrients } from '../nutrition/calc';
import { compatibleUnitsFor } from '../nutrition/units';
import { getCachedSourceFoods, saveFoodEntry } from '../services/foodLog';
import {
  MEAL_LABELS,
  type MealCategory,
  type NutrientValues,
  type SourceFood,
} from '../types';
import { escapeHtml, formatNumber } from '../util/hash';
import { setBanner, uiState } from './state';

const NUTRIENT_BREAKDOWN: Array<{
  key: keyof NutrientValues;
  label: string;
  unit: string;
  decimals: number;
}> = [
  { key: 'calories', label: 'Calories', unit: 'kcal', decimals: 0 },
  { key: 'protein', label: 'Protein', unit: 'g', decimals: 1 },
  { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g', decimals: 1 },
  { key: 'fat', label: 'Fat', unit: 'g', decimals: 1 },
  { key: 'fiber', label: 'Fiber', unit: 'g', decimals: 1 },
  { key: 'sugar', label: 'Sugar', unit: 'g', decimals: 1 },
  { key: 'saturatedFat', label: 'Saturated fat', unit: 'g', decimals: 1 },
  { key: 'cholesterol', label: 'Cholesterol', unit: '', decimals: 1 },
  { key: 'sodium', label: 'Sodium', unit: '', decimals: 1 },
  { key: 'potassium', label: 'Potassium', unit: '', decimals: 1 },
  { key: 'calcium', label: 'Calcium', unit: '', decimals: 1 },
  { key: 'iron', label: 'Iron', unit: '', decimals: 1 },
  { key: 'vitaminC', label: 'Vitamin C', unit: '', decimals: 1 },
  { key: 'vitaminA', label: 'Vitamin A', unit: '', decimals: 1 },
];

function breakdownTable(nutrients: NutrientValues): string {
  const rows = NUTRIENT_BREAKDOWN.map((row) => {
    const value = nutrients[row.key];
    const amount =
      value === null || value === undefined
        ? '—'
        : `${formatNumber(value, row.decimals)}${row.unit ? ` ${row.unit}` : ''}`;
    return `<tr class="nutrient-${row.key}"><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(amount)}</td></tr>`;
  }).join('');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nutrient</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export async function renderLogFood(
  root: HTMLElement,
  options?: { heading?: string; useEditing?: boolean },
): Promise<void> {
  const useEditing = options?.useEditing !== false;
  const settings = await getSettings();
  const foods = await getCachedSourceFoods();
  const selected = uiState.selectedFood;
  const editing = useEditing ? uiState.editingEntry : null;

  const unitOptions = selected
    ? compatibleUnitsFor(selected.basisUnit)
    : ['g', 'kg', 'ml', 'serving'];
  const typedWeight = (root.querySelector('#log-qty') as HTMLInputElement | null)?.value;
  const initialQty = typedWeight !== undefined ? typedWeight : (editing?.quantity ?? '');
  const initialUnit = editing?.unit ?? (unitOptions.includes('g') ? 'g' : (unitOptions[0] ?? 'g'));
  const queuedMeal = uiState.logMeal;
  uiState.logMeal = null;
  const initialMeal = editing?.meal ?? queuedMeal ?? 'breakfast';
  const initialDate = editing?.date ?? settings.selectedDate;
  const initialNotes = editing?.notes ?? '';

  root.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(options?.heading ?? (editing ? 'Edit food entry' : 'Log food'))}</h2>
      <div class="grid-2">
        <div class="field">
          <label for="log-date">Date</label>
          <input id="log-date" type="date" value="${escapeHtml(initialDate)}" />
        </div>
        <div class="field">
          <label for="log-meal">Meal</label>
          <select id="log-meal">
            ${(Object.keys(MEAL_LABELS) as MealCategory[])
              .map(
                (m) =>
                  `<option value="${m}" ${m === initialMeal ? 'selected' : ''}>${MEAL_LABELS[m]}</option>`,
              )
              .join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="food-search">Food</label>
        <input id="food-search" type="search" placeholder="Search" value="${escapeHtml(selected?.foodName ?? '')}" ${foods.length ? '' : 'disabled'} />
      </div>
      <div id="food-results" class="search-results" role="listbox" aria-label="Food matches"></div>
      <div class="grid-2" style="margin-top:10px">
        <div class="field">
          <label for="log-qty">Weight</label>
          <input id="log-qty" type="number" min="0" step="any" inputmode="decimal" value="${initialQty}" />
        </div>
        <div class="field">
          <label for="log-unit">Unit</label>
          <select id="log-unit">
            ${unitOptions
              .map(
                (u) =>
                  `<option value="${escapeHtml(u)}" ${u === initialUnit ? 'selected' : ''}>${escapeHtml(u)}</option>`,
              )
              .join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="log-notes">Notes</label>
        <textarea id="log-notes" rows="2">${escapeHtml(initialNotes)}</textarea>
      </div>
    </div>

    <div class="card">
      <h2>Breakdown</h2>
      <div id="nutrition-preview"></div>
      <div class="btn-row">
        <button class="primary" id="save-entry" disabled>${editing ? 'Update tracker' : 'Add to tracker'}</button>
        ${editing ? '<button class="ghost" id="cancel-edit">Cancel</button>' : ''}
      </div>
    </div>
  `;

  const searchInput = root.querySelector('#food-search') as HTMLInputElement;
  const results = root.querySelector('#food-results') as HTMLElement;
  const qtyInput = root.querySelector('#log-qty') as HTMLInputElement;
  const unitSelect = root.querySelector('#log-unit') as HTMLSelectElement;

  const renderResults = (query: string) => {
    const q = query.trim().toLowerCase();
    const matches = foods
      .filter(
        (f) =>
          !q ||
          f.foodName.toLowerCase().includes(q) ||
          f.foodId.toLowerCase().includes(q),
      )
      .slice(0, 20);
    results.innerHTML = matches
      .map((f) => {
        const selectedCls =
          selected && selected.foodId === f.foodId && selected.rowIndex === f.rowIndex
            ? 'selected'
            : '';
        return `<button type="button" class="${selectedCls}" data-id="${escapeHtml(f.foodId)}" data-row="${f.rowIndex}">
          <strong>${escapeHtml(f.foodName)}</strong>
          <div class="muted">${f.basisQuantity} ${escapeHtml(f.basisUnit)} · ${formatNumber(f.nutrients.calories, 0)} kcal</div>
        </button>`;
      })
      .join('');

    results.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const row = Number(btn.getAttribute('data-row'));
        const food = foods.find((f) => f.foodId === id && f.rowIndex === row) ?? null;
        uiState.selectedFood = food;
        void renderLogFood(root, options);
      });
    });
  };

  renderResults(searchInput.value);
  searchInput.addEventListener('input', () => renderResults(searchInput.value));

  const saveButton = root.querySelector('#save-entry') as HTMLButtonElement;

  const refreshPreview = () => {
    const box = root.querySelector('#nutrition-preview')!;
    const food = uiState.selectedFood;
    const qty = Number(qtyInput.value);
    if (!food || !(qty > 0)) {
      box.innerHTML = '';
      saveButton.disabled = true;
      return;
    }
    const calc = calculateNutrients({
      sourceFood: food,
      quantity: qty,
      unit: unitSelect.value,
      caloriesDecimals: settings.rounding.caloriesDecimals,
      macroDecimals: settings.rounding.macroDecimals,
    });
    if (!calc.ok) {
      box.innerHTML = `<p class="banner error">${escapeHtml(calc.error ?? 'Invalid')}</p>`;
      saveButton.disabled = true;
      return;
    }
    box.innerHTML = `
      <div class="stack-sm">
        <div><strong>${escapeHtml(food.foodName)}</strong> · ${qty} ${escapeHtml(unitSelect.value)}</div>
        ${breakdownTable(calc.nutrients)}
      </div>`;
    saveButton.disabled = false;
  };

  qtyInput.addEventListener('input', refreshPreview);
  unitSelect.addEventListener('change', refreshPreview);
  refreshPreview();

  root.querySelector('#cancel-edit')?.addEventListener('click', () => {
    uiState.editingEntry = null;
    uiState.selectedFood = null;
    const qty = root.querySelector('#log-qty') as HTMLInputElement | null;
    if (qty) qty.value = '';
    void renderLogFood(root, options);
  });

  root.querySelector('#save-entry')?.addEventListener('click', async () => {
    const food = uiState.selectedFood as SourceFood | null;
    if (!food) {
      setBanner('error', 'Choose a food from your list.');
      return;
    }
    try {
      const date = (root.querySelector('#log-date') as HTMLInputElement).value;
      const meal = (root.querySelector('#log-meal') as HTMLSelectElement).value as MealCategory;
      const quantity = Number((root.querySelector('#log-qty') as HTMLInputElement).value);
      const unit = (root.querySelector('#log-unit') as HTMLSelectElement).value;
      const notes = (root.querySelector('#log-notes') as HTMLTextAreaElement).value;
      const preview = calculateNutrients({
        sourceFood: food,
        quantity,
        unit,
        caloriesDecimals: settings.rounding.caloriesDecimals,
        macroDecimals: settings.rounding.macroDecimals,
      });
      if (!preview.ok) {
        setBanner('error', preview.error ?? 'Enter a weight.');
        refreshPreview();
        return;
      }

      const s = await getSettings();
      s.selectedDate = date;
      await saveSettings(s);

      const result = await saveFoodEntry({
        date,
        meal,
        sourceFood: food,
        quantity,
        unit,
        notes,
        entryId: editing?.entryId,
      });

      uiState.editingEntry = null;
      uiState.selectedFood = null;
      setBanner(result.workbookSynced ? 'success' : 'warning', result.message);
      uiState.tab = 'dashboard';
      window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'dashboard' }));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });
}

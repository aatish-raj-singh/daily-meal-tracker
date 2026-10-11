import { getSettings, saveSettings } from '../db/database';
import { calculateNutrients } from '../nutrition/calc';
import { compatibleUnitsFor } from '../nutrition/units';
import { getCachedSourceFoods, saveFoodEntry } from '../services/foodLog';
import { MEAL_LABELS, type MealCategory, type SourceFood } from '../types';
import { escapeHtml, formatNumber } from '../util/hash';
import { setBanner, uiState } from './state';

export async function renderLogFood(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const foods = await getCachedSourceFoods();
  const selected = uiState.selectedFood;
  const editing = uiState.editingEntry;

  const initialQty = editing?.quantity ?? 100;
  const initialUnit = editing?.unit ?? selected?.basisUnit ?? 'g';
  const initialMeal = editing?.meal ?? 'breakfast';
  const initialDate = editing?.date ?? settings.selectedDate;
  const initialNotes = editing?.notes ?? '';
  const unitOptions = selected
    ? compatibleUnitsFor(selected.basisUnit)
    : ['g', 'kg', 'ml', 'serving'];

  let previewHtml = '<p class="muted">Select a food and quantity to preview nutrition.</p>';
  if (selected) {
    const calc = calculateNutrients({
      sourceFood: selected,
      quantity: initialQty,
      unit: initialUnit,
      caloriesDecimals: settings.rounding.caloriesDecimals,
      macroDecimals: settings.rounding.macroDecimals,
    });
    if (calc.ok) {
      previewHtml = `
        <div class="stack-sm">
          <div><strong>${escapeHtml(selected.foodName)}</strong> <span class="muted">(ID: ${escapeHtml(selected.foodId)})</span></div>
          <div class="muted">Basis: ${selected.basisQuantity} ${escapeHtml(selected.basisUnit)} from ${escapeHtml(selected.sourceFileName)} / ${escapeHtml(selected.sourceWorksheet)}</div>
          <div>Calories: <strong>${formatNumber(calc.nutrients.calories, 0)}</strong></div>
          <div>Protein: <strong>${formatNumber(calc.nutrients.protein, 1)} g</strong></div>
          <div>Carbs: <strong>${formatNumber(calc.nutrients.carbohydrates, 1)} g</strong></div>
          <div>Fat: <strong>${formatNumber(calc.nutrients.fat, 1)} g</strong></div>
          <div>Fiber: <strong>${formatNumber(calc.nutrients.fiber, 1)} g</strong></div>
          ${
            calc.missingAsUnknown.length
              ? `<div class="muted">Unknown in source (not treated as zero): ${calc.missingAsUnknown.map(escapeHtml).join(', ')}</div>`
              : ''
          }
        </div>`;
    } else {
      previewHtml = `<p class="banner error">${escapeHtml(calc.error ?? 'Invalid quantity/unit')}</p>`;
    }
  }

  root.innerHTML = `
    <div class="card">
      <h2>${editing ? 'Edit food entry' : 'Log food'}</h2>
      ${
        foods.length === 0
          ? '<div class="banner warning">Import and map a nutrition source workbook in the Excel tab before logging food.</div>'
          : ''
      }
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
        <label for="food-search">Search food database</label>
        <input id="food-search" type="search" placeholder="Type a food name or ID" value="${escapeHtml(selected?.foodName ?? '')}" ${foods.length ? '' : 'disabled'} />
      </div>
      <div id="food-results" class="search-results" role="listbox" aria-label="Food matches"></div>
      <div class="grid-2" style="margin-top:10px">
        <div class="field">
          <label for="log-qty">Quantity</label>
          <input id="log-qty" type="number" min="0" step="any" value="${initialQty}" />
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
      <h3>Nutrition preview</h3>
      <div id="nutrition-preview">${previewHtml}</div>
      <div class="btn-row">
        <button class="primary" id="save-entry" ${selected ? '' : 'disabled'}>${editing ? 'Update entry' : 'Save entry'}</button>
        ${editing ? '<button class="ghost" id="cancel-edit">Cancel edit</button>' : ''}
      </div>
      <p class="muted" style="margin-top:10px">Values are calculated from the source workbook row and nutrition basis. Nothing is invented.</p>
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
          <div class="muted">ID ${escapeHtml(f.foodId)} · per ${f.basisQuantity} ${escapeHtml(f.basisUnit)} · ${formatNumber(f.nutrients.calories, 0)} kcal</div>
        </button>`;
      })
      .join('');

    results.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const row = Number(btn.getAttribute('data-row'));
        const food = foods.find((f) => f.foodId === id && f.rowIndex === row) ?? null;
        uiState.selectedFood = food;
        void renderLogFood(root);
      });
    });
  };

  renderResults(searchInput.value);
  searchInput.addEventListener('input', () => renderResults(searchInput.value));

  const refreshPreview = () => {
    if (!uiState.selectedFood) return;
    const qty = Number(qtyInput.value);
    const unit = unitSelect.value;
    const calc = calculateNutrients({
      sourceFood: uiState.selectedFood,
      quantity: qty,
      unit,
      caloriesDecimals: settings.rounding.caloriesDecimals,
      macroDecimals: settings.rounding.macroDecimals,
    });
    const box = root.querySelector('#nutrition-preview')!;
    if (!calc.ok) {
      box.innerHTML = `<p class="banner error">${escapeHtml(calc.error ?? 'Invalid')}</p>`;
      return;
    }
    box.innerHTML = `
      <div class="stack-sm">
        <div><strong>${escapeHtml(uiState.selectedFood.foodName)}</strong></div>
        <div class="muted">Basis: ${uiState.selectedFood.basisQuantity} ${escapeHtml(uiState.selectedFood.basisUnit)}</div>
        <div>Calories: <strong>${formatNumber(calc.nutrients.calories, 0)}</strong></div>
        <div>Protein: <strong>${formatNumber(calc.nutrients.protein, 1)} g</strong></div>
        <div>Carbs: <strong>${formatNumber(calc.nutrients.carbohydrates, 1)} g</strong></div>
        <div>Fat: <strong>${formatNumber(calc.nutrients.fat, 1)} g</strong></div>
        <div>Fiber: <strong>${formatNumber(calc.nutrients.fiber, 1)} g</strong></div>
      </div>`;
  };

  qtyInput.addEventListener('input', refreshPreview);
  unitSelect.addEventListener('change', refreshPreview);

  root.querySelector('#cancel-edit')?.addEventListener('click', () => {
    uiState.editingEntry = null;
    uiState.selectedFood = null;
    void renderLogFood(root);
  });

  root.querySelector('#save-entry')?.addEventListener('click', async () => {
    const food = uiState.selectedFood as SourceFood | null;
    if (!food) {
      setBanner('error', 'Choose a matching food from the source workbook.');
      return;
    }
    try {
      const date = (root.querySelector('#log-date') as HTMLInputElement).value;
      const meal = (root.querySelector('#log-meal') as HTMLSelectElement).value as MealCategory;
      const quantity = Number((root.querySelector('#log-qty') as HTMLInputElement).value);
      const unit = (root.querySelector('#log-unit') as HTMLSelectElement).value;
      const notes = (root.querySelector('#log-notes') as HTMLTextAreaElement).value;

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
        entryId: uiState.editingEntry?.entryId,
      });

      uiState.editingEntry = null;
      setBanner(result.workbookSynced ? 'success' : 'warning', result.message);
      uiState.tab = 'dashboard';
      window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'dashboard' }));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });
}

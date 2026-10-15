import { getSettings } from '../db/database';
import { getDashboardData } from '../services/foodLog';
import { MEAL_LABELS, type MealCategory } from '../types';
import { escapeHtml, formatNumber } from '../util/hash';

export async function renderBreakdown(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const { entries, totals } = await getDashboardData(settings.selectedDate);

  root.innerHTML = `
    <div class="btn-row" style="margin-top:0">
      <button type="button" class="ghost" id="breakdown-back">Back</button>
    </div>
    <div class="card">
      <h2>Meal breakdown</h2>
      <div class="muted">${escapeHtml(settings.selectedDate)}</div>
      <div class="list" style="margin-top:10px">
        ${(Object.keys(MEAL_LABELS) as MealCategory[])
          .map((meal) => {
            const m = totals.byMeal[meal];
            const foods = entries.filter((entry) => entry.meal === meal);
            const foodList =
              foods.length === 0
                ? ''
                : foods
                    .map(
                      (entry) =>
                        `<div class="meta">${escapeHtml(entry.sourceFoodName)} · ${entry.quantity} ${escapeHtml(entry.unit)} · ${formatNumber(entry.nutrients.calories, 0)} kcal</div>`,
                    )
                    .join('');
            return `
              <div class="list-item">
                <div class="title"><span class="meal-chip">${MEAL_LABELS[meal]}</span> · ${m.count} item(s)</div>
                <div class="meta"><span class="n-calories">${formatNumber(m.calories, 0)} kcal</span> · <span class="n-protein">P ${formatNumber(m.protein, 1)}</span> · <span class="n-carbs">C ${formatNumber(m.carbohydrates, 1)}</span> · <span class="n-fat">F ${formatNumber(m.fat, 1)}</span> · <span class="n-fiber">Fiber ${formatNumber(m.fiber, 1)}</span></div>
                ${foodList}
              </div>`;
          })
          .join('')}
      </div>
    </div>
  `;

  root.querySelector('#breakdown-back')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'dashboard' }));
  });
}

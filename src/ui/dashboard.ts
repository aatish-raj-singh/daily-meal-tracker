import { getDashboardData } from '../services/foodLog';
import { MEAL_LABELS, type MealCategory } from '../types';
import { escapeHtml, formatNumber } from '../util/hash';
import { saveStatusNote } from './state';
import { getSettings, saveSettings } from '../db/database';

function pct(value: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function remainingLabel(value: number, target: number, unit: string): string {
  const rem = target - value;
  if (rem >= 0) return `${formatNumber(rem, 1)} ${unit} remaining`;
  return `${formatNumber(Math.abs(rem), 1)} ${unit} over`;
}

export async function renderDashboard(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const { entries, totals } = await getDashboardData(settings.selectedDate);
  const t = settings.targets;
  const calPct = pct(totals.calories, t.calories);

  root.innerHTML = `
    <div class="card">
      <div class="field" style="margin-bottom:0">
        <label for="dash-date">Date</label>
        <input id="dash-date" type="date" value="${escapeHtml(settings.selectedDate)}" />
      </div>
    </div>

    <div class="card">
      <h2>Daily intake</h2>
      <div class="ring-wrap">
        <div class="ring" style="--pct:${calPct};--color:var(--calories)">
          <div class="ring-center">
            <strong>${formatNumber(totals.calories, 0)}</strong>
            <span class="muted">kcal</span>
          </div>
        </div>
        <div>
          <div class="metric">
            <div class="label">Calories</div>
            <div class="value">${formatNumber(totals.calories, 0)} / ${t.calories}</div>
            <div class="sub">${remainingLabel(totals.calories, t.calories, 'kcal')}</div>
            <div class="bar calories"><span style="--w:${calPct}%"></span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-macros">
      ${macroCard('Protein', totals.protein, t.protein, 'g', 'protein')}
      ${macroCard('Carbs', totals.carbohydrates, t.carbohydrates, 'g', 'carbs')}
      ${macroCard('Fat', totals.fat, t.fat, 'g', 'fat')}
      ${macroCard('Fiber', totals.fiber, t.fiber, 'g', 'fiber')}
    </div>

    <div class="card" style="margin-top:12px">
      <h2>Meal breakdown</h2>
      <div class="list">
        ${(Object.keys(MEAL_LABELS) as MealCategory[])
          .map((meal) => {
            const m = totals.byMeal[meal];
            return `
              <div class="list-item">
                <div class="title"><span class="meal-chip">${MEAL_LABELS[meal]}</span> · ${m.count} item(s)</div>
                <div class="meta">${formatNumber(m.calories, 0)} kcal · P ${formatNumber(m.protein, 1)} · C ${formatNumber(m.carbohydrates, 1)} · F ${formatNumber(m.fat, 1)} · Fiber ${formatNumber(m.fiber, 1)}</div>
              </div>`;
          })
          .join('')}
      </div>
    </div>

    <div class="card">
      <h2>Foods today</h2>
      ${
        entries.length === 0
          ? ''
          : `<div class="list">${entries
              .map(
                (e) => `
            <div class="list-item">
              <div class="title">${escapeHtml(e.sourceFoodName)} <span class="meal-chip">${MEAL_LABELS[e.meal]}</span></div>
              <div class="meta">${e.quantity} ${escapeHtml(e.unit)} · ${formatNumber(e.nutrients.calories, 0)} kcal${saveStatusNote(e.syncStatus) ? ` · ${saveStatusNote(e.syncStatus)}` : ''}</div>
            </div>`,
              )
              .join('')}</div>`
      }
    </div>
  `;

  root.querySelector('#dash-date')?.addEventListener('change', async (ev) => {
    const value = (ev.target as HTMLInputElement).value;
    const s = await getSettings();
    s.selectedDate = value;
    await saveSettings(s);
    await renderDashboard(root);
  });
}

function macroCard(
  label: string,
  value: number,
  target: number,
  unit: string,
  cls: string,
): string {
  const p = pct(value, target);
  return `
    <div class="metric">
      <div class="label">${label}</div>
      <div class="value">${formatNumber(value, 1)}</div>
      <div class="sub">of ${target}${unit} · ${remainingLabel(value, target, unit)}</div>
      <div class="bar ${cls}"><span style="--w:${p}%"></span></div>
    </div>
  `;
}

import { getSettings, saveSettings } from '../db/database';
import { weekdayName } from '../excel/workbook';
import { getDashboardData } from '../services/foodLog';
import { getDaySplit } from '../services/workout';
import { escapeHtml, formatNumber } from '../util/hash';

function pct(value: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function rawPct(value: number, target: number): number | null {
  if (!(target > 0)) return null;
  return Math.round((value / target) * 100);
}

function remainingLabel(value: number, target: number, unit: string): string {
  if (!(target > 0)) return 'No target';
  const rem = target - value;
  if (rem >= 0) return `${formatNumber(rem, unit === 'kcal' ? 0 : 1)} ${unit} left`;
  return `${formatNumber(Math.abs(rem), unit === 'kcal' ? 0 : 1)} ${unit} over`;
}

export async function renderDashboard(root: HTMLElement): Promise<void> {
  const settings = await getSettings();
  const { totals } = await getDashboardData(settings.selectedDate);
  const split = await getDaySplit(settings.selectedDate);
  const splitDay = weekdayName(settings.selectedDate);
  const t = settings.targets;
  const calPct = pct(totals.calories, t.calories);
  const calRaw = rawPct(totals.calories, t.calories);
  const caloriesOver = t.calories > 0 && totals.calories > t.calories;

  root.innerHTML = `
    <div class="dash-top">
      <div class="card date-card">
        <label for="dash-date">Date</label>
        <div class="date-row">
          <h2 class="day-name">${escapeHtml(splitDay)}</h2>
          <input id="dash-date" type="date" value="${escapeHtml(settings.selectedDate)}" />
        </div>
      </div>
      ${planRow(split, splitDay)}
    </div>

    <div class="card intake-card">
      <div class="section-head">
        <h2>Daily intake</h2>
        <span class="intake-pct${caloriesOver ? ' is-over' : ''}">${calRaw === null ? '—' : `${calRaw}%`}</span>
      </div>
      <div class="ring-wrap">
        <div class="ring${caloriesOver ? ' is-over' : ''}" style="--pct:${calPct};--color:${caloriesOver ? 'var(--danger)' : 'var(--calories)'}">
          <div class="ring-center">
            <strong>${formatNumber(totals.calories, 0)}</strong>
            <span class="muted">kcal</span>
          </div>
        </div>
        <div class="intake-copy">
          <div class="label">Calories</div>
          <div class="value">${formatNumber(totals.calories, 0)} <span>/ ${formatNumber(t.calories, 0)}</span></div>
          <div class="sub">${remainingLabel(totals.calories, t.calories, 'kcal')}</div>
          <div class="bar calories${caloriesOver ? ' is-over' : ''}"><span style="--w:${calPct}%"></span></div>
        </div>
      </div>
    </div>

    <div class="grid-macros">
      ${macroCard('Protein', totals.protein, t.protein, 'g', 'protein')}
      ${macroCard('Carbohydrates', totals.carbohydrates, t.carbohydrates, 'g', 'carbs')}
      ${macroCard('Fat', totals.fat, t.fat, 'g', 'fat')}
      ${macroCard('Fiber', totals.fiber, t.fiber, 'g', 'fiber')}
    </div>

    <div class="card">
      <h2>Today’s workout</h2>
      ${workoutDetail(split)}
    </div>
  `;

  root.querySelectorAll('.macro-card').forEach((card) => {
    card.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'breakdown' }));
    });
  });

  root.querySelectorAll('.setup-workout, .edit-plan').forEach((button) => {
    button.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('meal-tracker:navigate', { detail: 'excel' }));
    });
  });

  root.querySelector('#dash-date')?.addEventListener('change', async (ev) => {
    const value = (ev.target as HTMLInputElement).value;
    const s = await getSettings();
    s.selectedDate = value;
    await saveSettings(s);
    await renderDashboard(root);
  });
}

function planRow(split: Awaited<ReturnType<typeof getDaySplit>>, weekday: string): string {
  const title = !split ? 'No workout plan' : split.length === 0 ? 'Rest day' : `${weekday} workout`;
  const detail = !split ? 'Add a plan' : split.length === 0 ? weekday : `${split.length} exercise${split.length === 1 ? '' : 's'}`;
  const action = split
    ? `<button type="button" class="ghost edit-plan">Edit</button>`
    : `<button type="button" class="primary setup-workout">Set up</button>`;
  return `
    <div class="card plan-row">
      <span class="plan-icon" aria-hidden="true">${dumbbellIcon()}</span>
      <div class="plan-copy">
        <div class="title">${escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(detail)}</div>
      </div>
      ${action}
    </div>`;
}

function workoutDetail(split: Awaited<ReturnType<typeof getDaySplit>>): string {
  if (!split) {
    return `<p class="muted">No workout plan</p>
      <div class="btn-row"><button type="button" class="primary setup-workout">Set up workout plan</button></div>`;
  }
  if (split.length === 0) return `<p class="muted">Rest day</p>`;
  return `<div class="list">${split
    .map((row) => {
      const detail = [row.sets && `${row.sets} sets`, row.reps && `${row.reps} reps`, row.notes]
        .filter(Boolean)
        .join(' · ');
      return `<div class="list-item exercise-row">
        <div class="title">${escapeHtml(row.exercise)}</div>
        ${detail ? `<div class="meta">${escapeHtml(detail)}</div>` : ''}
      </div>`;
    })
    .join('')}</div>`;
}

function macroCard(
  label: string,
  value: number,
  target: number,
  unit: string,
  cls: string,
): string {
  const shown = rawPct(value, target);
  const over = target > 0 && value > target;
  return `
    <button type="button" class="metric macro-card macro-${cls}${over ? ' is-over' : ''}">
      <div class="macro-top">
        <div class="label">${label}</div>
        <div class="macro-pct">${shown === null ? '—' : `${shown}%`}</div>
      </div>
      <div class="value">${formatNumber(value, 1)} <span class="unit">${unit}</span></div>
      <div class="sub">of ${formatNumber(target, 0)}${unit} · ${remainingLabel(value, target, unit)}</div>
      <div class="bar ${cls}${over ? ' is-over' : ''}"><span style="--w:${pct(value, target)}%"></span></div>
    </button>
  `;
}

function dumbbellIcon(): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M6 9v6M18 9v6M3 10v4M21 10v4M6 12h12"/>
  </svg>`;
}

import {
  getDestinationConfig,
  getSourceConfig,
  getWorkoutConfig,
  saveDestinationConfig,
  saveSourceConfig,
  saveWorkoutConfig,
} from '../db/database';
import {
  requiredDestinationFieldsMapped,
  requiredSourceFieldsMapped,
  requiredWorkoutFieldsMapped,
} from '../excel/mapping';
import {
  addNutritionFood,
  importDestinationWorkbook,
  importSourceWorkbook,
  previewWorkbookSheet,
  updateDestinationMapping,
  updateSourceMapping,
} from '../services/foodLog';
import { importWorkoutWorkbook, updateWorkoutMapping, workoutPlanIsActive } from '../services/workout';
import {
  DESTINATION_FIELD_LABELS,
  SOURCE_FIELD_LABELS,
  WORKOUT_FIELD_LABELS,
  type DestinationField,
  type SourceField,
  type WorkoutField,
} from '../types';
import { chooseWorkbook, forgetFileHandle, saveSampleWorkbook, type PickerOutcome, type WorkbookKind } from '../excel/fileAccess';
import { buildMealLogSample, buildNutritionSample, buildWorkoutSample } from '../excel/samples';
import { escapeHtml } from '../util/hash';
import { setBanner } from './state';

export async function renderExcelSetup(root: HTMLElement): Promise<void> {
  const source = await getSourceConfig();
  const dest = await getDestinationConfig();
  const workout = await getWorkoutConfig();

  root.innerHTML = `
    <div class="card">
      <h2>Food list</h2>
      <div class="btn-row">
        <button type="button" class="secondary" id="source-sample">Download sample</button>
        <button type="button" class="primary" id="source-pick">Choose file</button>
      </div>
      <input id="source-file" class="sr-only" type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      ${nutritionMarkup(source)}
    </div>

    <div class="card">
      <h2>Meal log</h2>
      <div class="btn-row">
        <button type="button" class="secondary" id="dest-sample">Download sample</button>
        <button type="button" class="primary" id="dest-pick">Choose file</button>
      </div>
      <input id="dest-file" class="sr-only" type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      ${mealLogMarkup(dest)}
    </div>

    <div class="card">
      <h2>Workout plan</h2>
      <div class="btn-row">
        <button type="button" class="secondary" id="workout-sample">Download sample</button>
        <button type="button" class="primary" id="workout-pick">Choose file</button>
      </div>
      <input id="workout-file" class="sr-only" type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      ${workoutMarkup(workout)}
    </div>
  `;

  root.querySelector('#source-sample')?.addEventListener('click', async () => {
    try {
      await useWorkbookChoice(
        'source',
        await saveSampleWorkbook('source', 'nutrition-sheet.xlsx', buildNutritionSample()),
      );
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
    }
  });
  root.querySelector('#source-pick')?.addEventListener('click', async () => {
    try {
      await useWorkbookChoice('source', await chooseWorkbook('source'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
    }
  });
  root.querySelector('#source-file')?.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await forgetFileHandle('source');
      const result = await importSourceWorkbook(file);
      setBanner('success', `Added ${result.config.identity.fileName}`);
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#dest-sample')?.addEventListener('click', async () => {
    try {
      await useWorkbookChoice(
        'destination',
        await saveSampleWorkbook('destination', 'daily-meal-log.xlsx', buildMealLogSample()),
      );
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
    }
  });
  root.querySelector('#dest-pick')?.addEventListener('click', async () => {
    try {
      await useWorkbookChoice('destination', await chooseWorkbook('destination'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
    }
  });
  root.querySelector('#dest-file')?.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await forgetFileHandle('destination');
      const result = await importDestinationWorkbook(file);
      setBanner('success', `Added ${result.config.identity.fileName}`);
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#workout-sample')?.addEventListener('click', async () => {
    try {
      await useWorkbookChoice(
        'workout',
        await saveSampleWorkbook('workout', 'workout-plan.xlsx', buildWorkoutSample()),
      );
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
    }
  });
  root.querySelector('#workout-pick')?.addEventListener('click', async () => {
    try {
      await useWorkbookChoice('workout', await chooseWorkbook('workout'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
    }
  });
  root.querySelector('#workout-file')?.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await forgetFileHandle('workout');
      const result = await importWorkoutWorkbook(file);
      setBanner('success', `Added ${result.config.identity.fileName}`);
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  if (source && !nutritionIsActive(source)) {
    await populateSheetControls(root, 'source', source.worksheetName, source.headerRowIndex);
    root.querySelector('#save-source-map')?.addEventListener('click', async () => {
      const cfg = await getSourceConfig();
      if (!cfg) return;
      const mapping = readMapping<SourceField>(root, 'source', Object.keys(SOURCE_FIELD_LABELS) as SourceField[]);
      cfg.mapping = mapping;
      cfg.worksheetName = (root.querySelector('#source-sheet') as HTMLSelectElement).value;
      cfg.headerRowIndex = Number((root.querySelector('#source-header') as HTMLInputElement).value);
      const missing = requiredSourceFieldsMapped(cfg.mapping);
      if (missing.length) {
        setBanner(
          'error',
          `Match these columns: ${missing.map((field) => SOURCE_FIELD_LABELS[field as SourceField] ?? field).join(', ')}`,
        );
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
        return;
      }
      const preview = await previewWorkbookSheet('source', cfg.worksheetName, cfg.headerRowIndex);
      cfg.previewHeaders = preview.preview.headers;
      cfg.mappingSaved = true;
      await updateSourceMapping(cfg);
      setBanner('success', 'Food list saved.');
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    });
  }

  root.querySelector('#add-nutrition')?.addEventListener('click', async () => {
    const foodName = (root.querySelector('#nut-name') as HTMLInputElement).value.trim();
    const basisQuantity = Number((root.querySelector('#nut-qty') as HTMLInputElement).value);
    const basisUnit = (root.querySelector('#nut-unit') as HTMLInputElement).value.trim();
    if (!foodName || !(basisQuantity > 0) || !basisUnit) {
      setBanner('error', 'Enter a food name, amount, and unit.');
      return;
    }
    const numberOrNull = (id: string): number | null => {
      const raw = (root.querySelector(id) as HTMLInputElement).value.trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    try {
      await addNutritionFood({
        foodName,
        basisQuantity,
        basisUnit,
        nutrients: {
          calories: numberOrNull('#nut-cal'),
          protein: numberOrNull('#nut-pro'),
          carbohydrates: numberOrNull('#nut-carb'),
          fat: numberOrNull('#nut-fat'),
          fiber: numberOrNull('#nut-fiber'),
        },
      });
      setBanner('success', 'Added to the nutrition sheet.');
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  if (dest && !mealLogIsActive(dest)) {
    await populateSheetControls(root, 'dest', dest.worksheetName, dest.headerRowIndex);
    root.querySelector('#save-dest-map')?.addEventListener('click', async () => {
      const cfg = await getDestinationConfig();
      if (!cfg) return;
      const mapping = readMapping<DestinationField>(
        root,
        'dest',
        Object.keys(DESTINATION_FIELD_LABELS) as DestinationField[],
      );
      cfg.mapping = mapping;
      cfg.worksheetName = (root.querySelector('#dest-sheet') as HTMLSelectElement).value;
      cfg.headerRowIndex = Number((root.querySelector('#dest-header') as HTMLInputElement).value);
      const missing = requiredDestinationFieldsMapped(cfg.mapping);
      if (missing.length) {
        setBanner(
          'error',
          `Match these columns: ${missing.map((field) => DESTINATION_FIELD_LABELS[field as DestinationField] ?? field).join(', ')}`,
        );
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
        return;
      }
      const preview = await previewWorkbookSheet('destination', cfg.worksheetName, cfg.headerRowIndex);
      cfg.previewHeaders = preview.preview.headers;
      cfg.mappingSaved = true;
      await updateDestinationMapping(cfg);
      setBanner('success', 'Meal log saved.');
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    });
  }

  if (workout && !workoutPlanIsActive(workout)) {
    await populateSheetControls(root, 'workout', workout.worksheetName, workout.headerRowIndex);
    root.querySelector('#save-workout-map')?.addEventListener('click', async () => {
      const cfg = await getWorkoutConfig();
      if (!cfg) return;
      const mapping = readMapping<WorkoutField>(
        root,
        'workout',
        Object.keys(WORKOUT_FIELD_LABELS) as WorkoutField[],
      );
      cfg.mapping = mapping;
      cfg.worksheetName = (root.querySelector('#workout-sheet') as HTMLSelectElement).value;
      cfg.headerRowIndex = Number((root.querySelector('#workout-header') as HTMLInputElement).value);
      const missing = requiredWorkoutFieldsMapped(cfg.mapping);
      if (missing.length) {
        setBanner(
          'error',
          `Match these columns: ${missing.map((field) => WORKOUT_FIELD_LABELS[field as WorkoutField] ?? field).join(', ')}`,
        );
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
        return;
      }
      const preview = await previewWorkbookSheet('workout', cfg.worksheetName, cfg.headerRowIndex);
      cfg.previewHeaders = preview.preview.headers;
      cfg.mappingSaved = true;
      await updateWorkoutMapping(cfg);
      setBanner('success', 'Workout plan saved.');
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    });
  }
}

function nutritionIsActive(source: Awaited<ReturnType<typeof getSourceConfig>>): boolean {
  if (!source) return false;
  if (source.mappingSaved === true) return true;
  if (source.mappingSaved === false) return false;
  return requiredSourceFieldsMapped(source.mapping).length === 0;
}

function nutritionMarkup(source: Awaited<ReturnType<typeof getSourceConfig>>): string {
  if (!source) return '';
  if (!nutritionIsActive(source)) {
    return `<div><strong>${escapeHtml(source.identity.fileName)}</strong></div>
      <div class="field" style="margin-top:10px">
        <label for="source-sheet">Sheet</label>
        <select id="source-sheet"></select>
      </div>
      <div class="field">
        <label for="source-header">Header row</label>
        <input id="source-header" type="number" min="0" step="1" value="${source.headerRowIndex}" />
      </div>
      <div id="source-preview"></div>
      <div id="source-mapping"></div>
      <div class="btn-row">
        <button class="primary" id="save-source-map">Save</button>
      </div>`;
  }
  return `<div><strong>${escapeHtml(source.identity.fileName)}</strong></div>
    <div class="muted">Active nutrition sheet</div>
    <div class="field" style="margin-top:10px">
      <label for="nut-name">Food</label>
      <input id="nut-name" type="text" />
    </div>
    <div class="grid-2">
      <div class="field">
        <label for="nut-qty">Amount</label>
        <input id="nut-qty" type="number" min="0" step="any" value="100" />
      </div>
      <div class="field">
        <label for="nut-unit">Unit</label>
        <input id="nut-unit" type="text" value="g" />
      </div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="nut-cal">Calories</label><input id="nut-cal" type="number" min="0" step="any" /></div>
      <div class="field"><label for="nut-pro">Protein</label><input id="nut-pro" type="number" min="0" step="any" /></div>
      <div class="field"><label for="nut-carb">Carbohydrates</label><input id="nut-carb" type="number" min="0" step="any" /></div>
      <div class="field"><label for="nut-fat">Fat</label><input id="nut-fat" type="number" min="0" step="any" /></div>
      <div class="field"><label for="nut-fiber">Fiber</label><input id="nut-fiber" type="number" min="0" step="any" /></div>
    </div>
    <div class="btn-row">
      <button type="button" class="primary" id="add-nutrition">Add to sheet</button>
    </div>`;
}

function workoutMarkup(workout: Awaited<ReturnType<typeof getWorkoutConfig>>): string {
  if (!workout) return '';
  if (workoutPlanIsActive(workout)) {
    return `<div><strong>${escapeHtml(workout.identity.fileName)}</strong></div>
      <div class="muted">Active workout plan</div>`;
  }
  return `<div><strong>${escapeHtml(workout.identity.fileName)}</strong></div>
    <div class="field" style="margin-top:10px">
      <label for="workout-sheet">Sheet</label>
      <select id="workout-sheet"></select>
    </div>
    <div class="field">
      <label for="workout-header">Header row</label>
      <input id="workout-header" type="number" min="0" step="1" value="${workout.headerRowIndex}" />
    </div>
    <div id="workout-preview"></div>
    <div id="workout-mapping"></div>
    <div class="btn-row">
      <button class="primary" id="save-workout-map">Save</button>
    </div>`;
}

function mealLogIsActive(dest: Awaited<ReturnType<typeof getDestinationConfig>>): boolean {
  if (!dest) return false;
  if (dest.mappingSaved === true) return true;
  if (dest.mappingSaved === false) return false;
  return requiredDestinationFieldsMapped(dest.mapping).length === 0;
}

function mealLogMarkup(dest: Awaited<ReturnType<typeof getDestinationConfig>>): string {
  if (!dest) return '';
  if (mealLogIsActive(dest)) {
    return `<div><strong>${escapeHtml(dest.identity.fileName)}</strong></div>
      <div class="muted">Active meal log</div>`;
  }
  return `<div><strong>${escapeHtml(dest.identity.fileName)}</strong></div>
    <div class="field" style="margin-top:10px">
      <label for="dest-sheet">Sheet</label>
      <select id="dest-sheet"></select>
    </div>
    <div class="field">
      <label for="dest-header">Header row</label>
      <input id="dest-header" type="number" min="0" step="1" value="${dest.headerRowIndex}" />
    </div>
    <div id="dest-preview"></div>
    <div id="dest-mapping"></div>
    <div class="btn-row">
      <button class="primary" id="save-dest-map">Save</button>
    </div>`;
}

async function useWorkbookChoice(kind: WorkbookKind, outcome: PickerOutcome): Promise<void> {
  switch (outcome.status) {
    case 'cancelled':
      return;
    case 'downloaded':
      setBanner('success', 'Sample downloaded.');
      return;
    case 'unsupported': {
      const input = document.querySelector(fileInputId(kind));
      if (input instanceof HTMLInputElement) input.click();
      return;
    }
    case 'file': {
      if (!outcome.file) return;
      try {
        const fileName = await importChosenWorkbook(kind, outcome.file);
        setBanner('success', `Added ${fileName}`);
      } catch (err) {
        setBanner('error', err instanceof Error ? err.message : String(err));
      }
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      return;
    }
    default: {
      const exhaustive: never = outcome.status;
      return exhaustive;
    }
  }
}

function fileInputId(kind: WorkbookKind): string {
  switch (kind) {
    case 'source':
      return '#source-file';
    case 'destination':
      return '#dest-file';
    case 'workout':
      return '#workout-file';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

async function importChosenWorkbook(kind: WorkbookKind, file: File): Promise<string> {
  switch (kind) {
    case 'source':
      return (await importSourceWorkbook(file)).config.identity.fileName;
    case 'destination':
      return (await importDestinationWorkbook(file)).config.identity.fileName;
    case 'workout':
      return (await importWorkoutWorkbook(file)).config.identity.fileName;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

async function populateSheetControls(
  root: HTMLElement,
  kind: 'source' | 'dest' | 'workout',
  selectedSheet: string,
  headerRowIndex: number,
): Promise<void> {
  const blobKind = kind === 'source' ? 'source' : kind === 'workout' ? 'workout' : 'destination';
  const data = await previewWorkbookSheet(blobKind, selectedSheet, headerRowIndex);
  const sheetSelect = root.querySelector(`#${kind}-sheet`) as HTMLSelectElement | null;
  if (!sheetSelect) return;
  sheetSelect.innerHTML = data.sheetNames
    .map(
      (n) =>
        `<option value="${escapeHtml(n)}" ${n === selectedSheet ? 'selected' : ''}>${escapeHtml(n)}</option>`,
    )
    .join('');

  const renderPreviewAndMapping = async () => {
    const sheet = sheetSelect.value;
    const header = Number((root.querySelector(`#${kind}-header`) as HTMLInputElement).value);
    const preview = await previewWorkbookSheet(blobKind, sheet, header);
    const previewEl = root.querySelector(`#${kind}-preview`)!;
    previewEl.innerHTML = `
      <div class="table-wrap" style="margin:10px 0">
        <table>
          <thead><tr>${preview.preview.headers.map((h) => `<th>${escapeHtml(h || '(empty)')}</th>`).join('')}</tr></thead>
          <tbody>
            ${preview.preview.rows
              .map(
                (r) =>
                  `<tr>${preview.preview.headers.map((_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')}</tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>    `;

    const mappingEl = root.querySelector(`#${kind}-mapping`)!;
    if (kind === 'source') {
      const sourceCfg = await getSourceConfig();
      if (sourceCfg) {
        mappingEl.innerHTML = renderMappingControls(
          'source',
          SOURCE_FIELD_LABELS,
          sourceCfg.mapping,
          preview.preview.headers,
        );
        sourceCfg.worksheetName = sheet;
        sourceCfg.headerRowIndex = header;
        sourceCfg.previewHeaders = preview.preview.headers;
        await saveSourceConfig(sourceCfg);
      }
    } else if (kind === 'dest') {
      const destCfg = await getDestinationConfig();
      if (destCfg) {
        mappingEl.innerHTML = renderMappingControls(
          'dest',
          DESTINATION_FIELD_LABELS,
          destCfg.mapping,
          preview.preview.headers,
        );
        destCfg.worksheetName = sheet;
        destCfg.headerRowIndex = header;
        destCfg.previewHeaders = preview.preview.headers;
        await saveDestinationConfig(destCfg);
      }
    } else {
      const workoutCfg = await getWorkoutConfig();
      if (workoutCfg) {
        mappingEl.innerHTML = renderMappingControls(
          'workout',
          WORKOUT_FIELD_LABELS,
          workoutCfg.mapping,
          preview.preview.headers,
        );
        workoutCfg.worksheetName = sheet;
        workoutCfg.headerRowIndex = header;
        workoutCfg.previewHeaders = preview.preview.headers;
        await saveWorkoutConfig(workoutCfg);
      }
    }
  };

  await renderPreviewAndMapping();
  sheetSelect.addEventListener('change', () => void renderPreviewAndMapping());
  root
    .querySelector(`#${kind}-header`)
    ?.addEventListener('change', () => void renderPreviewAndMapping());
}

function renderMappingControls<T extends string>(
  prefix: string,
  labels: Record<T, string>,
  mapping: Partial<Record<T, number | null>>,
  headers: string[],
): string {
  return `
    <h3>Match columns</h3>
    <div class="stack-sm">
      ${(Object.keys(labels) as T[])
        .map((field) => {
          const current = mapping[field];
          return `
          <div class="field">
            <label for="${prefix}-map-${field}">${escapeHtml(labels[field])}</label>
            <select id="${prefix}-map-${field}" data-map-field="${field}">
              <option value="">Skip</option>
              ${headers
                .map(
                  (h, i) =>
                    `<option value="${i}" ${current === i ? 'selected' : ''}>${i}: ${escapeHtml(h || '(empty)')}</option>`,
                )
                .join('')}
            </select>
          </div>`;
        })
        .join('')}
    </div>
  `;
}

function readMapping<T extends string>(
  root: HTMLElement,
  prefix: string,
  fields: T[],
): Partial<Record<T, number | null>> {
  const mapping: Partial<Record<T, number | null>> = {};
  for (const field of fields) {
    const el = root.querySelector(`#${prefix}-map-${field}`) as HTMLSelectElement | null;
    if (!el || el.value === '') {
      mapping[field] = null;
    } else {
      mapping[field] = Number(el.value);
    }
  }
  return mapping;
}

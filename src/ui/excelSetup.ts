import {
  getDestinationConfig,
  getSourceConfig,
  saveDestinationConfig,
  saveSourceConfig,
} from '../db/database';
import {
  requiredDestinationFieldsMapped,
  requiredSourceFieldsMapped,
} from '../excel/mapping';
import {
  importDestinationWorkbook,
  importSourceWorkbook,
  previewWorkbookSheet,
  updateDestinationMapping,
  updateSourceMapping,
} from '../services/foodLog';
import {
  DESTINATION_FIELD_LABELS,
  SOURCE_FIELD_LABELS,
  type DestinationField,
  type SourceField,
} from '../types';
import { escapeHtml } from '../util/hash';
import { setBanner } from './state';

export async function renderExcelSetup(root: HTMLElement): Promise<void> {
  const source = await getSourceConfig();
  const dest = await getDestinationConfig();

  root.innerHTML = `
    <div class="card">
      <h2>Nutrition source workbook</h2>
      <p class="muted">Choose the Excel file that contains food names and nutrition values. This file is never modified.</p>
      <div class="field">
        <label for="source-file">Select source workbook</label>
        <input id="source-file" type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      </div>
      ${
        source
          ? `<div class="stack-sm muted">
              <div>File: <strong>${escapeHtml(source.identity.fileName)}</strong></div>
              <div>Imported: ${escapeHtml(source.identity.importedAt)}</div>
              <div>SHA-256: ${escapeHtml(source.identity.sha256.slice(0, 16))}…</div>
              <div>Worksheet: <strong>${escapeHtml(source.worksheetName)}</strong></div>
              <div>Header row (0-based): ${source.headerRowIndex}</div>
            </div>
            <div class="field" style="margin-top:10px">
              <label for="source-sheet">Source worksheet</label>
              <select id="source-sheet"></select>
            </div>
            <div class="field">
              <label for="source-header">Header row index</label>
              <input id="source-header" type="number" min="0" step="1" value="${source.headerRowIndex}" />
            </div>
            <div id="source-preview"></div>
            <div id="source-mapping"></div>
            <div class="btn-row">
              <button class="primary" id="save-source-map">Save source mapping</button>
            </div>`
          : '<p class="muted">No source workbook imported yet.</p>'
      }
    </div>

    <div class="card">
      <h2>Destination / food log workbook</h2>
      <p class="muted">Independently choose the workbook where food entries are saved. Do not reuse the nutrition source file.</p>
      <div class="field">
        <label for="dest-file">Select destination workbook</label>
        <input id="dest-file" type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      </div>
      ${
        dest
          ? `<div class="stack-sm muted">
              <div>File: <strong>${escapeHtml(dest.identity.fileName)}</strong></div>
              <div>Imported: ${escapeHtml(dest.identity.importedAt)}</div>
              <div>SHA-256: ${escapeHtml(dest.identity.sha256.slice(0, 16))}…</div>
              <div>Worksheet: <strong>${escapeHtml(dest.worksheetName)}</strong></div>
              <div>Last verified export: ${escapeHtml(dest.lastVerifiedExportAt ?? 'never')}</div>
              <div>Recovery copy: ${escapeHtml(dest.lastBackupAt ?? 'not created')}</div>
            </div>
            <div class="field" style="margin-top:10px">
              <label for="dest-sheet">Destination worksheet</label>
              <select id="dest-sheet"></select>
            </div>
            <div class="field">
              <label for="dest-header">Header row index</label>
              <input id="dest-header" type="number" min="0" step="1" value="${dest.headerRowIndex}" />
            </div>
            <div id="dest-preview"></div>
            <div id="dest-mapping"></div>
            <div class="btn-row">
              <button class="primary" id="save-dest-map">Save destination mapping</button>
            </div>`
          : '<p class="muted">No destination workbook imported yet.</p>'
      }
    </div>

    <div class="card">
      <h3>iPhone / Files note</h3>
      <p class="muted">Safari and other mobile browsers generally cannot silently overwrite an arbitrary file in the Files app. After syncing, use <strong>Settings → Export destination workbook</strong> and save the timestamped file. A recovery copy is kept in local storage before each write.</p>
    </div>
  `;

  root.querySelector('#source-file')?.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const result = await importSourceWorkbook(file);
      setBanner(
        'success',
        `Source imported: ${result.config.identity.fileName}. Choose worksheet and map columns.`,
      );
      if (result.warnings.length) {
        setBanner('warning', result.warnings[0]);
      }
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  root.querySelector('#dest-file')?.addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const result = await importDestinationWorkbook(file);
      setBanner(
        'success',
        `Destination imported: ${result.config.identity.fileName}. Map columns before logging.`,
      );
      if (result.warnings.length) {
        console.warn(result.warnings);
      }
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    } catch (err) {
      setBanner('error', err instanceof Error ? err.message : String(err));
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    }
  });

  if (source) {
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
        setBanner('error', `Map required source fields: ${missing.join(', ')}`);
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
        return;
      }
      const preview = await previewWorkbookSheet('source', cfg.worksheetName, cfg.headerRowIndex);
      cfg.previewHeaders = preview.preview.headers;
      await updateSourceMapping(cfg);
      setBanner('success', 'Source worksheet and column mapping saved.');
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    });
  }

  if (dest) {
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
        setBanner('error', `Map required destination fields: ${missing.join(', ')}`);
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
        return;
      }
      const preview = await previewWorkbookSheet('destination', cfg.worksheetName, cfg.headerRowIndex);
      cfg.previewHeaders = preview.preview.headers;
      await updateDestinationMapping(cfg);
      setBanner('success', 'Destination worksheet and column mapping saved.');
      window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
    });
  }
}

async function populateSheetControls(
  root: HTMLElement,
  kind: 'source' | 'dest',
  selectedSheet: string,
  headerRowIndex: number,
): Promise<void> {
  const blobKind = kind === 'source' ? 'source' : 'destination';
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
      </div>
      <p class="muted">${preview.preview.totalRows} data row(s) detected. Warnings: ${preview.warnings.length}</p>
    `;

    const cfg = kind === 'source' ? await getSourceConfig() : await getDestinationConfig();
    const mappingEl = root.querySelector(`#${kind}-mapping`)!;
    if (kind === 'source' && cfg && 'mapping' in cfg) {
      mappingEl.innerHTML = renderMappingControls(
        'source',
        SOURCE_FIELD_LABELS,
        (cfg as Awaited<ReturnType<typeof getSourceConfig>>)!.mapping,
        preview.preview.headers,
      );
    } else if (kind === 'dest' && cfg) {
      mappingEl.innerHTML = renderMappingControls(
        'dest',
        DESTINATION_FIELD_LABELS,
        cfg.mapping,
        preview.preview.headers,
      );
    }

    // Persist sheet/header choice lightly so preview stays in sync
    if (kind === 'source') {
      const sourceCfg = await getSourceConfig();
      if (sourceCfg) {
        sourceCfg.worksheetName = sheet;
        sourceCfg.headerRowIndex = header;
        sourceCfg.previewHeaders = preview.preview.headers;
        await saveSourceConfig(sourceCfg);
      }
    } else {
      const destCfg = await getDestinationConfig();
      if (destCfg) {
        destCfg.worksheetName = sheet;
        destCfg.headerRowIndex = header;
        destCfg.previewHeaders = preview.preview.headers;
        await saveDestinationConfig(destCfg);
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
    <h3>Column mapping</h3>
    <div class="stack-sm">
      ${(Object.keys(labels) as T[])
        .map((field) => {
          const current = mapping[field];
          return `
          <div class="field">
            <label for="${prefix}-map-${field}">${escapeHtml(labels[field])}</label>
            <select id="${prefix}-map-${field}" data-map-field="${field}">
              <option value="">(not mapped)</option>
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

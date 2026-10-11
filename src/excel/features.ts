import type { WorkBook } from 'xlsx';
import type { FeatureWarnings } from '../types';

/**
 * SheetJS community edition can lose macros, charts, pivot tables, data validation,
 * drawings, and some formatting on round-trip. Detect what we can from the workbook object.
 */
export function detectWorkbookFeatures(wb: WorkBook, originalFileName: string): FeatureWarnings {
  const messages: string[] = [];
  const lower = originalFileName.toLowerCase();
  const hasMacros = lower.endsWith('.xlsm') || lower.endsWith('.xlsb');

  const wbAny = wb as WorkBook & {
    Workbook?: {
      Names?: unknown[];
      Sheets?: Array<{ Hidden?: number }>;
    };
    Custprops?: unknown;
    Props?: unknown;
  };

  const hasDefinedNames = Boolean(wbAny.Workbook?.Names && wbAny.Workbook.Names.length > 0);

  // SheetJS does not fully expose charts/pivots/validation in the community build.
  // We warn conservatively whenever a destination round-trip is planned.
  const hasCharts = false;
  const hasPivotTables = false;
  const hasDataValidations = false;
  const hasExternalLinks = false;

  if (hasMacros) {
    messages.push(
      'Macro-enabled workbook detected (.xlsm/.xlsb). Macros and VBA are not preserved by the Excel library used in this app.',
    );
  }

  messages.push(
    'Round-trip limitation: charts, pivot tables, data validation, conditional formatting, drawings, and some styles may be lost or altered when this app rewrites the destination workbook.',
  );
  messages.push(
    'Unrelated worksheets are kept in the workbook object when possible, but perfect binary preservation is not guaranteed.',
  );

  if (hasDefinedNames) {
    messages.push('Named ranges were detected. Some named ranges may not round-trip perfectly.');
  }

  return {
    hasMacros,
    hasCharts,
    hasPivotTables,
    hasDataValidations,
    hasExternalLinks,
    hasDefinedNames,
    messages,
  };
}

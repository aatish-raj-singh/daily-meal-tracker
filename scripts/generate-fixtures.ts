import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.join(root, 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

/** Nutrition source with a non-default sheet and alternate header names. */
function buildSourceWorkbook(): void {
  const wb = XLSX.utils.book_new();

  // Decoy first sheet
  const meta = XLSX.utils.aoa_to_sheet([
    ['Meta', 'Value'],
    ['Owner', 'Test User'],
    ['Notes', 'Do not use this sheet for foods'],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, 'ReadMe');

  // Actual foods on second sheet with alternate headers
  const foods = XLSX.utils.aoa_to_sheet([
    [
      'Item Code',
      'Item Name',
      'Serving Qty',
      'Serving Unit',
      'Energy kcal',
      'Protein (g)',
      'Total Carbs',
      'Total Fat',
      'Dietary Fibre',
      'Sugars',
      'Sodium',
    ],
    ['CHK-001', 'Chicken Breast', 100, 'g', 165, 31, 0, 3.6, 0, 0, 74],
    ['RICE-01', 'Cooked White Rice', 100, 'g', 130, 2.7, 28, 0.3, 0.4, 0.1, 1],
    ['OAT-01', 'Rolled Oats', 40, 'g', 150, 5, 27, 3, 4, 1, 2],
    ['MILK-01', 'Whole Milk', 240, 'ml', 150, 8, 12, 8, 0, 12, 105],
    ['APP-01', 'Apple', 1, 'serving', 95, 0.5, 25, 0.3, 4.4, 19, 2],
    ['EGG-01', 'Egg Large', 1, 'piece', 72, 6.3, 0.4, 4.8, 0, 0.2, 71],
  ]);
  XLSX.utils.book_append_sheet(wb, foods, 'FoodDB');

  // Extra unrelated sheet
  const refs = XLSX.utils.aoa_to_sheet([
    ['Reference', 'URL'],
    ['USDA', 'https://example.local/usda'],
  ]);
  XLSX.utils.book_append_sheet(wb, refs, 'References');

  const out = path.join(fixturesDir, 'nutrition-source.xlsx');
  XLSX.writeFile(wb, out);
  console.log('Wrote', out);
}

/** Destination log with historical rows and an unrelated sheet with a formula. */
function buildDestinationWorkbook(): void {
  const wb = XLSX.utils.book_new();

  const summary = XLSX.utils.aoa_to_sheet([
    ['Week', 'Target Calories', 'Notes'],
    ['2026-W01', 14000, 'Unrelated historical summary sheet'],
    ['2026-W02', 14000, 'Keep this worksheet during FoodLog updates'],
  ]);
  XLSX.utils.book_append_sheet(wb, summary, 'WeeklySummary');

  const log = XLSX.utils.aoa_to_sheet([
    [
      'Entry_ID',
      'Date',
      'Time',
      'Meal',
      'Food_Name',
      'Quantity',
      'Unit',
      'Calories',
      'Protein',
      'Carbohydrates',
      'Fat',
      'Fiber',
      'Notes',
      'Source_Food_ID',
      'Last_Modified',
    ],
    [
      'hist-0001-aaaa-bbbb-cccccccccccc',
      '2026-01-01',
      '08:00',
      'breakfast',
      'Historical Oats',
      40,
      'g',
      150,
      5,
      27,
      3,
      4,
      'pre-existing historical row',
      'OAT-01',
      '2026-01-01T08:00:00.000Z',
    ],
  ]);
  XLSX.utils.book_append_sheet(wb, log, 'FoodLog');

  const out = path.join(fixturesDir, 'food-log-destination.xlsx');
  XLSX.writeFile(wb, out);
  console.log('Wrote', out);
}

function buildIcons(): void {
  const iconsDir = path.join(root, 'public', 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  // Minimal valid solid-color PNGs (192 and 512) via raw uncompressed PNG writer
  writeSolidPng(path.join(iconsDir, 'icon-192.png'), 192, 15, 118, 110);
  writeSolidPng(path.join(iconsDir, 'icon-512.png'), 512, 15, 118, 110);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f766e"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#99f6e4" stroke-width="36"/>
  <path d="M180 280c30 50 122 50 152 0" fill="none" stroke="#ecfdf5" stroke-width="28" stroke-linecap="round"/>
  <circle cx="210" cy="220" r="18" fill="#ecfdf5"/>
  <circle cx="302" cy="220" r="18" fill="#ecfdf5"/>
</svg>`;
  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svg);
  fs.writeFileSync(path.join(root, 'public', 'favicon.svg'), svg);
  console.log('Wrote icons');
}

function writeSolidPng(filePath: string, size: number, r: number, g: number, b: number): void {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const compressed = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(filePath, Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]));
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c;
}

buildSourceWorkbook();
buildDestinationWorkbook();
buildIcons();

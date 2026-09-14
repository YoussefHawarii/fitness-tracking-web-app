// Loads the bilingual Egyptian food catalog from egyptian-food-catalog.csv —
// sourced from the National Nutrition Institute (Egypt) Food Composition
// Tables, 2nd ed. (2006), via
// https://www.kaggle.com/datasets/mernamohamed3/egyptian-food (CC BY 4.0 —
// credit: National Nutrition Institute, Egypt). Values are per 100g edible
// portion (ENERGY/PROTEIN/FAT/CARBOHYDRATE columns only — this app's schema
// doesn't track the source table's other columns like fiber/minerals).
//
// A handful of source rows were excluded or corrected during import — see
// docs/egyptian-food-catalog-import.md for the full list and reasoning (3
// rows dropped for unrecoverable data corruption; a 9-row block of
// nuts/legumes had duplicated protein=fat values, corrected against live
// USDA reference data; near-duplicate raw-grain variants were consolidated
// rather than imported 1:1). Arabic names/aliases (including Egyptian
// colloquial terms) were added by hand — the source dataset is English-only.
//
// The CSV's `category` column is for human browsing (open it in Excel) and
// isn't loaded into the app. Its `notes` column carries the per-item
// reasoning that used to live as inline code comments here (e.g. why two
// preparations of the same food share a search alias).
import * as fs from 'fs';
import * as path from 'path';
import type { SeedFood } from './seed-food.type';

const CSV_PATH = path.join(__dirname, 'egyptian-food-catalog.csv');

// Strict enough to fail loudly on a malformed hand-edit rather than silently
// mangling data: a quote is only valid at the very start of a field (not
// mid-field), a closing quote must be immediately followed by a comma/
// newline/EOF (not stray trailing characters), and an unterminated quoted
// field at EOF is an error, not a truncated-but-accepted field.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;

  const pushField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
  };
  const pushRow = () => {
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          const next = text[i + 1];
          if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
            throw new Error(
              `egyptian-food-catalog.csv: unexpected character right after a closing quote (position ${i + 1})`,
            );
          }
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (!atFieldStart) {
        throw new Error(
          `egyptian-food-catalog.csv: unexpected quote character inside an unquoted field (position ${i})`,
        );
      }
      inQuotes = true;
      atFieldStart = false;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushField();
      pushRow();
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (inQuotes) {
    throw new Error(
      'egyptian-food-catalog.csv: file ends inside an unterminated quoted field',
    );
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function columnIndex(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i === -1) {
    throw new Error(
      `egyptian-food-catalog.csv is missing required column "${name}"`,
    );
  }
  return i;
}

function splitAliases(cell: string | undefined): string[] {
  return (cell ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function requiredNumber(cell: string | undefined, nameEn: string, field: string): number {
  const trimmed = (cell ?? '').trim();
  const n = Number(trimmed);
  // `Number('')` and `Number('   ')` are both 0 in JS, which would otherwise
  // let a blank required cell silently become "0 calories" instead of erroring.
  if (trimmed === '' || !Number.isFinite(n)) {
    throw new Error(
      `egyptian-food-catalog.csv: "${nameEn}" has a non-numeric ${field} ("${cell}")`,
    );
  }
  return n;
}

function optionalNumber(cell: string | undefined, nameEn: string, field: string): number | undefined {
  const trimmed = (cell ?? '').trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(
      `egyptian-food-catalog.csv: "${nameEn}" has a non-numeric ${field} ("${cell}")`,
    );
  }
  return n;
}

// `csvText` defaults to reading the real file — the default is only
// evaluated when the function is called with no argument (i.e. once, below),
// so tests can pass synthetic CSV text directly without touching the file.
function loadCatalog(
  csvText: string = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, ''),
): SeedFood[] {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error('egyptian-food-catalog.csv is empty');
  }
  const header = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));

  const col = {
    nameEn: columnIndex(header, 'nameEn'),
    nameAr: columnIndex(header, 'nameAr'),
    aliasesEn: columnIndex(header, 'aliasesEn'),
    aliasesAr: columnIndex(header, 'aliasesAr'),
    caloriesPer100g: columnIndex(header, 'caloriesPer100g'),
    proteinPer100g: columnIndex(header, 'proteinPer100g'),
    carbsPer100g: columnIndex(header, 'carbsPer100g'),
    fatPer100g: columnIndex(header, 'fatPer100g'),
  };

  const seenNames = new Set<string>();
  return dataRows.map((r, i) => {
    // A column-count mismatch means the row's fields no longer line up with
    // `col` at all (e.g. a comma lost or gained by a hand-edit) — reject it
    // outright rather than reading whichever wrong column happens to be
    // there next.
    if (r.length !== header.length) {
      throw new Error(
        `egyptian-food-catalog.csv: row ${i + 2} has ${r.length} columns, expected ${header.length}`,
      );
    }
    const nameEn = r[col.nameEn]?.trim();
    const nameAr = r[col.nameAr]?.trim();
    if (!nameEn || !nameAr) {
      throw new Error(
        `egyptian-food-catalog.csv: row ${i + 2} is missing nameEn or nameAr`,
      );
    }
    if (seenNames.has(nameEn)) {
      throw new Error(
        `egyptian-food-catalog.csv: duplicate nameEn "${nameEn}" (row ${i + 2})`,
      );
    }
    seenNames.add(nameEn);

    return {
      nameEn,
      nameAr,
      aliasesEn: splitAliases(r[col.aliasesEn]),
      aliasesAr: splitAliases(r[col.aliasesAr]),
      caloriesPer100g: requiredNumber(r[col.caloriesPer100g], nameEn, 'caloriesPer100g'),
      proteinPer100g: optionalNumber(r[col.proteinPer100g], nameEn, 'proteinPer100g'),
      carbsPer100g: optionalNumber(r[col.carbsPer100g], nameEn, 'carbsPer100g'),
      fatPer100g: optionalNumber(r[col.fatPer100g], nameEn, 'fatPer100g'),
    };
  });
}

export const EGYPTIAN_FOOD_CATALOG: SeedFood[] = loadCatalog();

// Exported for direct unit testing of the parsing/validation logic without
// exercising the full 428-row real file — see test/prisma/egyptian-food-catalog.spec.ts.
export { parseCsv, loadCatalog };

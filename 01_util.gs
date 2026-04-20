// ============================================================
// 01_util.gs — Project Cantor: Mise en Place
// Shared utility functions used across all modules.
// ============================================================

// ── Spreadsheet Access ────────────────────────────────────────

/**
 * Returns the Cantor spreadsheet by ID from CONFIG.
 * Using openById() supports both standalone and bound scripts.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

// ── Sheet Access ──────────────────────────────────────────────

/**
 * Returns a sheet by name. Throws a descriptive error if not found.
 * @param {string} name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(name) {
  const sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`getSheet: sheet not found — "${name}"`);
  return sheet;
}

/**
 * Returns all data rows from a sheet as an array of arrays.
 * Excludes the header row. Returns [] if the sheet has no data.
 * @param {string} sheetName
 * @returns {any[][]}
 */
function getAllRows(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

/**
 * Returns all data rows as objects keyed by the field names
 * in CONFIG.COL[colKey]. Column indices are 1-based in CONFIG,
 * 0-based in the row array — this handles the conversion.
 * @param {string} sheetName
 * @param {string} colKey — key in CONFIG.COL
 * @returns {Object[]}
 */
function getAllRowsAsObjects(sheetName, colKey) {
  const colMap = CONFIG.COL[colKey];
  if (!colMap) throw new Error(`getAllRowsAsObjects: no column map for "${colKey}"`);
  return getAllRows(sheetName).map(row => rowToObject_(row, colMap));
}

/**
 * Converts a single row array to an object using a column map.
 * @param {any[]} row
 * @param {Object} colMap — field name → 1-based column index
 * @returns {Object}
 */
function rowToObject_(row, colMap) {
  const obj = {};
  Object.entries(colMap).forEach(([field, colIndex]) => {
    obj[field] = row[colIndex - 1];
  });
  return obj;
}

/**
 * Appends a single data row to a sheet using a field map.
 * Only writes fields that exist in the column map.
 * @param {string} sheetName
 * @param {string} colKey
 * @param {Object} data — { FIELD_NAME: value, ... }
 */
function appendRow(sheetName, colKey, data) {
  const colMap = CONFIG.COL[colKey];
  if (!colMap) throw new Error(`appendRow: no column map for "${colKey}"`);

  const maxCol = Math.max(...Object.values(colMap));
  const row = new Array(maxCol).fill('');
  Object.entries(colMap).forEach(([field, colIndex]) => {
    if (data.hasOwnProperty(field)) row[colIndex - 1] = data[field];
  });
  getSheet(sheetName).appendRow(row);
}

// ── ID Generation ─────────────────────────────────────────────

/**
 * Returns the next sequential integer ID for a given sheet.
 * Reads the last value in the ID column (col 1) and increments.
 * Returns 1 if the sheet has no data rows.
 * @param {string} sheetName
 * @returns {number}
 */
function nextId(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const lastId = sheet.getRange(lastRow, 1).getValue();
  return (Number(lastId) || 0) + 1;
}

// ── Date Utilities ────────────────────────────────────────────

/**
 * Returns today as a Date with time zeroed to midnight.
 * @returns {Date}
 */
function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the number of whole calendar days between two dates.
 * Positive when dateB is after dateA.
 * @param {Date|string} dateA
 * @param {Date|string} dateB
 * @returns {number}
 */
function daysBetween(dateA, dateB) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const a = new Date(dateA); a.setHours(0, 0, 0, 0);
  const b = new Date(dateB); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / msPerDay);
}

/**
 * Returns days elapsed since a past date (positive = in the past).
 * Returns Infinity for empty/null inputs.
 * @param {Date|string} date
 * @returns {number}
 */
function daysSince(date) {
  if (!date || date === '') return Infinity;
  return daysBetween(new Date(date), today());
}

/**
 * Returns days remaining until a future date (positive = in the future).
 * Returns Infinity for empty/null inputs.
 * @param {Date|string} date
 * @returns {number}
 */
function daysUntil(date) {
  if (!date || date === '') return Infinity;
  return daysBetween(today(), new Date(date));
}

/**
 * Formats a Date as YYYY-MM-DD string.
 * Returns '' for falsy input.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Recency Decay ─────────────────────────────────────────────

/**
 * Computes the recency component of the cookability score.
 *
 * Returns 0.0 if cooked today, scaling linearly to 1.0 once
 * RECENCY.DECAY_DAYS have elapsed. Recipes never cooked return 1.0.
 *
 * Curve: score = min(daysSinceCooked / DECAY_DAYS, 1.0)
 *
 * @param {Date|string|''} lastCookedDate
 * @returns {number} 0.0 – 1.0
 */
function recencyScore(lastCookedDate) {
  if (!lastCookedDate || lastCookedDate === '') return 1.0;
  const days = daysSince(lastCookedDate);
  if (days <= 0) return 0.0;
  return Math.min(days / CONFIG.RECENCY.DECAY_DAYS, 1.0);
}

// ── Ingredient Delta ──────────────────────────────────────────

/**
 * Computes the ingredient delta component of the cookability score.
 *
 * Fewer missing ingredients = higher score.
 * Uses a diminishing penalty: each missing ingredient reduces the score,
 * with larger gaps penalised more steeply.
 *
 * Formula: max(0, 1 - (missingCount / totalCount))
 * Falls back to 1.0 if totalCount is 0.
 *
 * @param {number} missingCount
 * @param {number} totalCount
 * @returns {number} 0.0 – 1.0
 */
function ingredientDeltaScore(missingCount, totalCount) {
  if (totalCount === 0) return 1.0;
  return Math.max(0, 1 - (missingCount / totalCount));
}

// ── Alias Resolution ──────────────────────────────────────────

/**
 * Resolves a raw ingredient text string to a master ingredient ID.
 * Case-insensitive match against Ingredient_Aliases.
 *
 * Returns null if no match found. The caller is responsible for
 * prompting the user to create or select a master ingredient.
 *
 * @param {string} rawText
 * @returns {number|null} master ingredient ID or null
 */
function resolveAlias(rawText) {
  if (!rawText) return null;
  const normalised = rawText.toString().trim().toLowerCase();
  const rows = getAllRows(CONFIG.SHEETS.INGREDIENT_ALIASES);
  const colAlias    = CONFIG.COL.INGREDIENT_ALIASES.ALIAS_TEXT           - 1;
  const colMasterId = CONFIG.COL.INGREDIENT_ALIASES.MASTER_INGREDIENT_ID - 1;

  for (const row of rows) {
    if (str(row[colAlias]).toLowerCase() === normalised) {
      return Number(row[colMasterId]);
    }
  }
  return null;
}

/**
 * Looks up a master ingredient record by ID.
 * Returns null if not found.
 * @param {number} ingredientId
 * @returns {Object|null}
 */
function getIngredientById(ingredientId) {
  const rows = getAllRows(CONFIG.SHEETS.INGREDIENTS_MASTER);
  const colId = CONFIG.COL.INGREDIENTS_MASTER.ID - 1;
  const row = rows.find(r => Number(r[colId]) === Number(ingredientId));
  if (!row) return null;
  return rowToObject_(row, CONFIG.COL.INGREDIENTS_MASTER);
}

// ── Stock State Builders ──────────────────────────────────────

/**
 * Returns a Set of ingredient IDs currently considered PRESENT.
 *
 * Includes:
 *   - All Pantry_Stock rows where OUT_OF_STOCK !== TRUE
 *     (covers both regular stock and staples)
 *   - All Perishable_Stock rows where STATE !== 'used'
 *
 * Staple logic: a staple with OUT_OF_STOCK = TRUE is excluded,
 * so missing staples correctly register as absent.
 *
 * @returns {Set<number>}
 */
function getPresentIngredientIds() {
  const present = new Set();

  // Pantry (includes staples)
  const pantryRows = getAllRows(CONFIG.SHEETS.PANTRY_STOCK);
  const pIngId = CONFIG.COL.PANTRY_STOCK.INGREDIENT_ID - 1;
  const pOos   = CONFIG.COL.PANTRY_STOCK.OUT_OF_STOCK   - 1;
  pantryRows.forEach(row => {
    if (row[pOos] !== true) present.add(Number(row[pIngId]));
  });

  // Perishables (present unless consumed)
  const perishRows = getAllRows(CONFIG.SHEETS.PERISHABLE_STOCK);
  const periIngId = CONFIG.COL.PERISHABLE_STOCK.INGREDIENT_ID - 1;
  const periState = CONFIG.COL.PERISHABLE_STOCK.STATE          - 1;
  perishRows.forEach(row => {
    if (str(row[periState]) !== CONFIG.PERISHABLE_STATES.USED) {
      present.add(Number(row[periIngId]));
    }
  });

  return present;
}

/**
 * Returns a Set of ingredient IDs for near-expiry perishables.
 * Includes rows where:
 *   - STATE is 'use_soon' or 'critical', OR
 *   - daysUntil(USE_BY_DATE) <= USE_UP.USE_SOON_DAYS
 *
 * @returns {Set<number>}
 */
function getNearExpiryIngredientIds() {
  const nearExpiry = new Set();
  const rows = getAllRows(CONFIG.SHEETS.PERISHABLE_STOCK);
  const colIngId = CONFIG.COL.PERISHABLE_STOCK.INGREDIENT_ID - 1;
  const colUseBy = CONFIG.COL.PERISHABLE_STOCK.USE_BY_DATE   - 1;
  const colState = CONFIG.COL.PERISHABLE_STOCK.STATE          - 1;

  rows.forEach(row => {
    const state = str(row[colState]);
    const useBy = row[colUseBy];
    const urgentState   = state === CONFIG.PERISHABLE_STATES.CRITICAL ||
                          state === CONFIG.PERISHABLE_STATES.USE_SOON;
    const urgentByDate  = useBy && daysUntil(useBy) <= CONFIG.USE_UP.USE_SOON_DAYS;

    if (urgentState || urgentByDate) {
      nearExpiry.add(Number(row[colIngId]));
    }
  });

  return nearExpiry;
}

/**
 * Returns the Set of active household person IDs.
 * Used by review logic to compute Family Approved coverage.
 * @returns {Set<number>}
 */
function getActivePersonIds() {
  const rows = getAllRows(CONFIG.SHEETS.HOUSEHOLD_PEOPLE);
  const colId     = CONFIG.COL.HOUSEHOLD_PEOPLE.ID        - 1;
  const colActive = CONFIG.COL.HOUSEHOLD_PEOPLE.IS_ACTIVE - 1;
  const active = new Set();
  rows.forEach(row => {
    if (row[colActive] === true) active.add(Number(row[colId]));
  });
  return active;
}

// ── Sub-Recipe Flattening ─────────────────────────────────────

/**
 * Flattens sub-recipe ingredients into a parent recipe's ingredient list.
 * Returns the full deduplicated set of ingredient IDs for a recipe,
 * including one level of sub-recipe resolution.
 *
 * @param {number} recipeId
 * @param {Map<number, number[]>} recipeIngMap   — recipeId → [ingredientIds]
 * @param {Map<number, number[]>} subrecipeMap   — parentId → [childRecipeIds]
 * @returns {number[]} deduplicated ingredient ID array
 */
function flattenRecipeIngredients(recipeId, recipeIngMap, subrecipeMap) {
  const ids = new Set(recipeIngMap.get(recipeId) || []);

  // One level of sub-recipe resolution
  const children = subrecipeMap.get(recipeId) || [];
  children.forEach(childId => {
    const childIngs = recipeIngMap.get(childId) || [];
    childIngs.forEach(id => ids.add(id));
  });

  return Array.from(ids);
}

// ── String Helpers ────────────────────────────────────────────

/**
 * Safely coerces any value to a trimmed string.
 * Returns '' for null/undefined.
 * @param {any} val
 * @returns {string}
 */
function str(val) {
  if (val === null || val === undefined) return '';
  return val.toString().trim();
}

/**
 * Clamps a number between min and max (inclusive).
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Rounds a number to a given number of decimal places.
 * @param {number} val
 * @param {number} [dp=4]
 * @returns {number}
 */
function round(val, dp) {
  const factor = Math.pow(10, dp !== undefined ? dp : 4);
  return Math.round(val * factor) / factor;
}

// ── Diagnostic Runner ─────────────────────────────────────────

/**
 * Runs a quick sanity check on util functions. Call from the GAS editor.
 */
function diagUtil() {
  Logger.log('=== diagUtil ===');
  Logger.log('today(): ' + formatDate(today()));
  Logger.log('recencyScore(today): '     + recencyScore(today()));
  Logger.log('recencyScore(15 days ago): ' + recencyScore(new Date(Date.now() - 15 * 86400000)));
  Logger.log('recencyScore(null): '      + recencyScore(null));
  Logger.log('ingredientDeltaScore(1,4): ' + ingredientDeltaScore(1, 4));
  Logger.log('ingredientDeltaScore(0,4): ' + ingredientDeltaScore(0, 4));
  Logger.log('ingredientDeltaScore(4,4): ' + ingredientDeltaScore(4, 4));
  Logger.log('str(null): "' + str(null) + '"');
  Logger.log('clamp(1.5, 0, 1): ' + clamp(1.5, 0, 1));
}

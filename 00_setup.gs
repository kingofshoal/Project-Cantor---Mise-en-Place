// ============================================================
// 00_setup.gs — Project Cantor: Mise en Place
// Sheet creation and initialisation routines.
//
// RUN ORDER (once only, on a fresh spreadsheet):
//   1. createAllSheets()
//   2. diagSheets()        ← verify everything landed correctly
// ============================================================

/**
 * Master setup function. Creates all Cantor sheets with headers.
 * Safe to re-run: existing sheets are left intact, only missing
 * sheets are created. Check Logger output after running.
 */
function createAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];

  const sheetsToCreate = [
    // ── Raw data sheets ──────────────────────────────────────
    { name: CONFIG.SHEETS.RECIPES,             colKey: 'RECIPES'             },
    { name: CONFIG.SHEETS.RECIPE_INGREDIENTS,  colKey: 'RECIPE_INGREDIENTS'  },
    { name: CONFIG.SHEETS.RECIPE_METHOD,       colKey: 'RECIPE_METHOD'       },
    { name: CONFIG.SHEETS.RECIPE_SUBRECIPES,   colKey: 'RECIPE_SUBRECIPES'   },
    { name: CONFIG.SHEETS.INGREDIENTS_MASTER,  colKey: 'INGREDIENTS_MASTER'  },
    { name: CONFIG.SHEETS.INGREDIENT_ALIASES,  colKey: 'INGREDIENT_ALIASES'  },
    { name: CONFIG.SHEETS.PANTRY_STOCK,        colKey: 'PANTRY_STOCK'        },
    { name: CONFIG.SHEETS.PERISHABLE_STOCK,    colKey: 'PERISHABLE_STOCK'    },
    { name: CONFIG.SHEETS.HOUSEHOLD_PEOPLE,    colKey: 'HOUSEHOLD_PEOPLE'    },
    { name: CONFIG.SHEETS.MEAL_HISTORY,        colKey: 'MEAL_HISTORY'        },
    { name: CONFIG.SHEETS.RECIPE_REVIEWS,      colKey: 'RECIPE_REVIEWS'      },
    { name: CONFIG.SHEETS.SHOPPING_LISTS,      colKey: 'SHOPPING_LISTS'      },
    { name: CONFIG.SHEETS.SHOPPING_LIST_ITEMS, colKey: 'SHOPPING_LIST_ITEMS' },
    // ── Summary / cache sheets ───────────────────────────────
    { name: CONFIG.SHEETS.SUMMARY_MATCH,       colKey: 'SUMMARY_MATCH'       },
    { name: CONFIG.SHEETS.SUMMARY_USEUP,       colKey: 'SUMMARY_USEUP'       },
    { name: CONFIG.SHEETS.SUMMARY_BUY_UNLOCK,  colKey: 'SUMMARY_BUY_UNLOCK'  },
    { name: CONFIG.SHEETS.SUMMARY_REVIEWS,     colKey: 'SUMMARY_REVIEWS'     },
  ];

  sheetsToCreate.forEach(({ name, colKey }) => {
    const existing = ss.getSheetByName(name);
    if (existing) {
      results.push(`SKIP   ${name} — already exists`);
      return;
    }
    const sheet = ss.insertSheet(name);
    const headers = deriveHeaders_(colKey);
    applyHeaderRow_(sheet, headers);
    results.push(`CREATE ${name} (${headers.length} columns)`);
  });

  // Remove the default 'Sheet1' if it exists and is empty
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
    results.push('REMOVE Sheet1 (empty default sheet)');
  }

  Logger.log('=== createAllSheets complete ===');
  results.forEach(r => Logger.log(r));
}

// ── Header Utilities ──────────────────────────────────────────

/**
 * Derives an ordered header array from a CONFIG.COL key.
 * Converts UPPER_SNAKE_CASE field names to Title Case strings,
 * sorted by their column index value.
 * @param {string} colKey
 * @returns {string[]}
 */
function deriveHeaders_(colKey) {
  const colMap = CONFIG.COL[colKey];
  if (!colMap) throw new Error(`deriveHeaders_: no column map for key "${colKey}"`);

  return Object.entries(colMap)
    .sort(([, a], [, b]) => a - b)
    .map(([fieldName]) =>
      fieldName.toLowerCase()
               .replace(/_/g, ' ')
               .replace(/\b\w/g, c => c.toUpperCase())
    );
}

/**
 * Writes a styled header row to row 1 of a sheet and freezes it.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function applyHeaderRow_(sheet, headers) {
  if (!headers || headers.length === 0) return;
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground('#1F3864');
  range.setFontColor('#FFFFFF');
  range.setWrap(false);
  sheet.setFrozenRows(1);
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Logs all expected sheet names with their current row counts.
 * Run from the GAS editor after createAllSheets() to verify.
 */
function diagSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('=== diagSheets ===');

  let missing = 0;
  Object.entries(CONFIG.SHEETS).forEach(([key, name]) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      Logger.log(`MISSING  [${key}]  ${name}`);
      missing++;
    } else {
      const dataRows = Math.max(0, sheet.getLastRow() - 1);
      Logger.log(`OK       [${key}]  ${name}  (${dataRows} data rows)`);
    }
  });

  Logger.log(`=== ${missing === 0 ? 'All sheets present' : missing + ' sheet(s) missing'} ===`);
}

/**
 * Logs the header row of a given sheet by CONFIG key.
 * Useful for verifying column alignment after a schema change.
 * @param {string} sheetConfigKey — e.g. 'RECIPES', 'PANTRY_STOCK'
 */
function diagHeaders(sheetConfigKey) {
  const sheetName = CONFIG.SHEETS[sheetConfigKey];
  if (!sheetName) {
    Logger.log(`diagHeaders: unknown key "${sheetConfigKey}"`);
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log(`diagHeaders: sheet not found — ${sheetName}`);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log(`=== ${sheetName} headers ===`);
  headers.forEach((h, i) => Logger.log(`  Col ${i + 1}: ${h}`));
}

// ── Destructive Utilities (use with caution) ──────────────────

/**
 * Deletes all Cantor-managed sheets.
 * Requires explicit confirmation to prevent accidental runs.
 * Call as: deleteAllSheets(true)
 * @param {boolean} confirmed — must be true to proceed
 */
function deleteAllSheets(confirmed) {
  if (confirmed !== true) {
    Logger.log('deleteAllSheets: not confirmed. Call deleteAllSheets(true) to proceed.');
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let deleted = 0;
  Object.values(CONFIG.SHEETS).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      ss.deleteSheet(sheet);
      Logger.log(`DELETED  ${name}`);
      deleted++;
    }
  });
  Logger.log(`deleteAllSheets: removed ${deleted} sheet(s)`);
}

/**
 * Clears all data rows from a single sheet (header preserved).
 * Useful during development for resetting a single domain.
 * Call as: clearSheet('RECIPES')
 * @param {string} sheetConfigKey
 */
function clearSheet(sheetConfigKey) {
  const sheetName = CONFIG.SHEETS[sheetConfigKey];
  if (!sheetName) {
    Logger.log(`clearSheet: unknown key "${sheetConfigKey}"`);
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log(`clearSheet: sheet not found — ${sheetName}`);
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log(`clearSheet: ${sheetName} already empty`);
    return;
  }
  sheet.deleteRows(2, lastRow - 1);
  Logger.log(`clearSheet: cleared ${lastRow - 1} rows from ${sheetName}`);
}

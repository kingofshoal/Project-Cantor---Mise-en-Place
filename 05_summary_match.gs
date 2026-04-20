// ============================================================
// 05_summary_match.gs — Project Cantor: Mise en Place
// Rebuilds the Summary_Recipe_Match cache sheet.
//
// This is the primary summary table. The dashboard Cook Tonight
// tile, recipe search, and all result group views read from here.
//
// Also contains shared summary write utilities used by
// 06, 07, and 08 — all files share GAS's global scope.
// ============================================================

/**
 * Rebuilds Summary_Recipe_Match from current stock state.
 *
 * Steps:
 *   1. Auto-update perishable states (ensures dates are current)
 *   2. Score all recipes via the matching engine
 *   3. Clear the summary sheet
 *   4. Batch-write results
 *
 * @param {Object}  [options]
 * @param {boolean} [options.approvedOnly=false]
 * @returns {{ rowsWritten: number, elapsedMs: number }}
 */
function rebuildSummaryMatch(options) {
  const FN = 'rebuildSummaryMatch';
  logInfo(FN, 'Rebuild started');
  const t0 = Date.now();

  // Step 1: Ensure perishable states reflect today's dates
  autoUpdatePerishableStates();

  // Step 2: Score all recipes
  const results = scoreAllRecipes(options || {});

  // Step 3 & 4: Write to summary sheet
  const timestamp = formatDate(today());
  const rows = results.map(r => buildMatchRow_(r, timestamp));

  clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_MATCH, 'SUMMARY_MATCH', rows);

  const elapsed = Date.now() - t0;
  logInfo(FN, `Rebuild complete: ${rows.length} rows in ${elapsed}ms`);
  Logger.log(`rebuildSummaryMatch: ${rows.length} recipes written (${elapsed}ms)`);

  return { rowsWritten: rows.length, elapsedMs: elapsed };
}

/**
 * Builds a Summary_Recipe_Match row array from a scored recipe result.
 * Column order matches CONFIG.COL.SUMMARY_MATCH exactly.
 *
 * @param {Object} result    — from scoreRecipe_ / scoreAllRecipes
 * @param {string} timestamp — rebuild date string
 * @returns {any[]}
 */
function buildMatchRow_(result, timestamp) {
  return objectToSummaryRow_({
    RECIPE_ID:              result.RECIPE_ID,
    RECIPE_NAME:            result.RECIPE_NAME,
    INGREDIENT_MATCH_SCORE: result.INGREDIENT_MATCH_SCORE,
    COOKABILITY_SCORE:      result.COOKABILITY_SCORE,
    USE_UP_BONUS:           result.USE_UP_BONUS,
    COMPOSITE_SCORE:        result.COMPOSITE_SCORE,
    RESULT_GROUP:           result.RESULT_GROUP,
    MISSING_COUNT:          result.MISSING_COUNT,
    MISSING_PRIMARIES:      result.MISSING_PRIMARIES,
    LAST_REBUILT:           timestamp,
  }, 'SUMMARY_MATCH');
}

/**
 * Logs a snapshot of the current Summary_Recipe_Match contents.
 * Run from the GAS editor after a rebuild to verify output.
 */
function diagSummaryMatch() {
  Logger.log('=== diagSummaryMatch ===');

  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
  if (rows.length === 0) {
    Logger.log('Summary_Recipe_Match is empty — run rebuildSummaryMatch() first');
    return;
  }

  const colGroup   = CONFIG.COL.SUMMARY_MATCH.RESULT_GROUP    - 1;
  const colScore   = CONFIG.COL.SUMMARY_MATCH.COMPOSITE_SCORE - 1;
  const colName    = CONFIG.COL.SUMMARY_MATCH.RECIPE_NAME     - 1;
  const colRebuilt = CONFIG.COL.SUMMARY_MATCH.LAST_REBUILT    - 1;

  const groupCounts = {};
  Object.values(CONFIG.RESULT_GROUPS).forEach(g => { groupCounts[g] = 0; });
  rows.forEach(r => {
    const g = str(r[colGroup]);
    if (groupCounts[g] !== undefined) groupCounts[g]++;
  });

  Logger.log(`Total rows: ${rows.length}  (rebuilt: ${rows[0][colRebuilt]})`);
  Logger.log('');
  Object.entries(groupCounts).forEach(([group, count]) => {
    Logger.log(`  ${group}: ${count}`);
  });

  Logger.log('\nTop 10 by composite score:');
  const sorted = [...rows].sort((a, b) => Number(b[colScore]) - Number(a[colScore]));
  sorted.slice(0, 10).forEach((r, i) => {
    Logger.log(`  ${String(i + 1).padStart(2)}. [${Number(r[colScore]).toFixed(3)}] ${r[colName]}`);
  });
}

// ── Shared Summary Utilities ──────────────────────────────────
// Available to 06, 07, 08 via GAS global scope.

/**
 * Clears all data rows from a summary sheet and batch-writes new rows.
 * Preserves the header row. Handles empty result sets gracefully.
 *
 * @param {string}  sheetName
 * @param {string}  colKey     — CONFIG.COL key for column count
 * @param {any[][]} rows       — pre-built row arrays (from objectToSummaryRow_)
 */
function clearAndWriteSummary_(sheetName, colKey, rows) {
  const sheet   = getSheet(sheetName);
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  if (rows.length === 0) return;

  const colCount = Math.max(...Object.values(CONFIG.COL[colKey]));
  sheet.getRange(2, 1, rows.length, colCount).setValues(rows);
}

/**
 * Converts a plain object to a row array matching a CONFIG.COL key layout.
 * Fields in the colMap absent from the object default to ''.
 *
 * @param {Object} obj
 * @param {string} colKey — CONFIG.COL key
 * @returns {any[]}
 */
function objectToSummaryRow_(obj, colKey) {
  const colMap = CONFIG.COL[colKey];
  const maxCol = Math.max(...Object.values(colMap));
  const row    = new Array(maxCol).fill('');
  Object.entries(colMap).forEach(([field, colIndex]) => {
    if (obj.hasOwnProperty(field)) row[colIndex - 1] = obj[field];
  });
  return row;
}

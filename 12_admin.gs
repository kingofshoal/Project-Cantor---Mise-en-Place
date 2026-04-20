// ============================================================
// 12_admin.gs — Project Cantor: Mise en Place
// Administration: master rebuild orchestration, system status,
// full diagnostic runner.
//
// All functions are designed to be run directly from the GAS editor.
// None require UI interaction — check Logger output after running.
// ============================================================

// ── Master Rebuild ────────────────────────────────────────────

/**
 * Rebuilds all four summary sheets in the correct dependency order:
 *   1. Summary_Recipe_Match  (primary; also calls autoUpdatePerishableStates)
 *   2. Summary_UseUp         (depends on perishable state and recipe scores)
 *   3. Summary_BuyUnlock     (depends on near-match recipe scores)
 *   4. Summary_ReviewSignals (independent, but run last for completeness)
 *
 * This is the function to call from the admin panel "Rebuild Now" button
 * and from any scheduled trigger (future backlog).
 *
 * Logs a timing summary on completion.
 *
 * @param {Object}  [options]
 * @param {boolean} [options.approvedOnly=false] — pass to match engine
 * @returns {{ success: boolean, results: Object, totalMs: number }}
 */
function rebuildAllSummaries(options) {
  const FN  = 'rebuildAllSummaries';
  const t0  = Date.now();
  logInfo(FN, 'Full rebuild started');
  Logger.log('=== rebuildAllSummaries ===');

  const opts = options || {};
  const results = {};

  try {
    results.match   = rebuildSummaryMatch(opts);
    Logger.log(`  Summary_Recipe_Match  : ${results.match.rowsWritten} rows  (${results.match.elapsedMs}ms)`);
  } catch (e) {
    logError(FN, 'rebuildSummaryMatch failed', { error: e.message });
    Logger.log(`  Summary_Recipe_Match  : FAILED — ${e.message}`);
    results.match = { error: e.message };
  }

  try {
    results.useUp   = rebuildSummaryUseUp();
    Logger.log(`  Summary_UseUp         : ${results.useUp.rowsWritten} rows  (${results.useUp.elapsedMs}ms)`);
  } catch (e) {
    logError(FN, 'rebuildSummaryUseUp failed', { error: e.message });
    Logger.log(`  Summary_UseUp         : FAILED — ${e.message}`);
    results.useUp = { error: e.message };
  }

  try {
    results.buy     = rebuildSummaryBuyUnlock();
    Logger.log(`  Summary_BuyUnlock     : ${results.buy.rowsWritten} rows  (${results.buy.elapsedMs}ms)`);
  } catch (e) {
    logError(FN, 'rebuildSummaryBuyUnlock failed', { error: e.message });
    Logger.log(`  Summary_BuyUnlock     : FAILED — ${e.message}`);
    results.buy = { error: e.message };
  }

  try {
    results.reviews = rebuildSummaryReviews();
    Logger.log(`  Summary_ReviewSignals : ${results.reviews.rowsWritten} rows  (${results.reviews.elapsedMs}ms)`);
  } catch (e) {
    logError(FN, 'rebuildSummaryReviews failed', { error: e.message });
    Logger.log(`  Summary_ReviewSignals : FAILED — ${e.message}`);
    results.reviews = { error: e.message };
  }

  const totalMs = Date.now() - t0;
  const hadErrors = Object.values(results).some(r => r.error);

  Logger.log(`\nTotal time: ${totalMs}ms  Status: ${hadErrors ? 'COMPLETED WITH ERRORS' : 'OK'}`);
  logInfo(FN, `Full rebuild complete in ${totalMs}ms`, { hadErrors });

  return { success: !hadErrors, results, totalMs };
}

/**
 * API-safe wrapper for rebuildAllSummaries.
 * Called by the SPA admin panel via google.script.run.
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function rebuildAllSummariesApi() {
  try {
    const result = rebuildAllSummaries();
    return ok_(result);
  } catch (e) {
    return err_(`rebuildAllSummaries failed: ${e.message}`, 'rebuildAllSummariesApi');
  }
}

// ── System Status ─────────────────────────────────────────────

/**
 * Returns a snapshot of all sheet row counts and the last rebuild date.
 * Read-only — safe to call at any time.
 *
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function getSystemStatus() {
  const FN = 'getSystemStatus';
  try {
    const ss     = getSpreadsheet();
    const sheets = {};

    Object.entries(CONFIG.SHEETS).forEach(([key, name]) => {
      const sheet = ss.getSheetByName(name);
      sheets[key] = sheet
        ? { name, rows: Math.max(0, sheet.getLastRow() - 1), exists: true }
        : { name, rows: 0, exists: false };
    });

    // Last rebuilt from Summary_Recipe_Match
    const matchRows = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
    const lastRebuilt = matchRows.length > 0
      ? str(matchRows[0][CONFIG.COL.SUMMARY_MATCH.LAST_REBUILT - 1])
      : null;

    // Quick health indicators
    const health = {
      sheetsAllPresent: Object.values(sheets).every(s => s.exists),
      hasRecipes:       (sheets.RECIPES.rows || 0) > 0,
      hasStock:         (sheets.PANTRY_STOCK.rows || 0) > 0 ||
                        (sheets.PERISHABLE_STOCK.rows || 0) > 0,
      summaryBuilt:     (sheets.SUMMARY_MATCH.rows || 0) > 0,
      lastRebuilt,
    };

    return ok_({ sheets, health });
  } catch (e) {
    return err_(`getSystemStatus failed: ${e.message}`, FN);
  }
}

// ── Full Diagnostic Runner ────────────────────────────────────

/**
 * Runs all diagnostic functions in sequence and logs combined output.
 * Use when investigating unexpected behaviour or after a fresh setup.
 * Takes longer than individual diag functions — allow 30–60 seconds.
 */
function runFullDiagnostic() {
  Logger.log('╔══════════════════════════════════════════╗');
  Logger.log('║   Project Cantor — Full Diagnostic Run   ║');
  Logger.log('╚══════════════════════════════════════════╝');
  Logger.log('');

  Logger.log('── 1. Sheet structure ───────────────────────');
  diagSheets();
  Logger.log('');

  Logger.log('── 2. Utility functions ─────────────────────');
  diagUtil();
  Logger.log('');

  Logger.log('── 3. Scoring rules ─────────────────────────');
  diagRecipeRules();
  Logger.log('');

  Logger.log('── 4. Recipe entry data ─────────────────────');
  diagRecipeEntry();
  Logger.log('');

  Logger.log('── 5. Stock state ───────────────────────────');
  diagStock();
  Logger.log('');

  Logger.log('── 6. Matching engine ───────────────────────');
  diagMatchingEngine();
  Logger.log('');

  Logger.log('── 7. Summary: Match ────────────────────────');
  diagSummaryMatch();
  Logger.log('');

  Logger.log('── 8. Summary: Use Up ───────────────────────');
  diagSummaryUseUp();
  Logger.log('');

  Logger.log('── 9. Summary: Buy Unlock ───────────────────');
  diagSummaryBuyUnlock();
  Logger.log('');

  Logger.log('── 10. Summary: Reviews ─────────────────────');
  diagSummaryReviews();
  Logger.log('');

  Logger.log('── 11. Log summary ──────────────────────────');
  diagLogSummary();
  Logger.log('');

  Logger.log('╔══════════════════════════════════════════╗');
  Logger.log('║   Full diagnostic complete               ║');
  Logger.log('╚══════════════════════════════════════════╝');
}

// ── Quick System Check ────────────────────────────────────────

/**
 * Lightweight check — row counts and health flags only.
 * Run this before a rebuild to confirm data is in a sensible state.
 */
function quickCheck() {
  Logger.log('=== quickCheck ===');
  const status = getSystemStatus();
  if (!status.success) {
    Logger.log('ERROR: ' + status.error);
    return;
  }

  const { sheets, health } = status.data;

  Logger.log(`Sheets all present : ${health.sheetsAllPresent ? 'YES' : 'NO — run createAllSheets()'}`);
  Logger.log(`Has recipes        : ${health.hasRecipes ? 'YES' : 'NO'}`);
  Logger.log(`Has stock          : ${health.hasStock ? 'YES' : 'NO'}`);
  Logger.log(`Summary built      : ${health.summaryBuilt ? 'YES' : 'NO — run rebuildAllSummaries()'}`);
  Logger.log(`Last rebuilt       : ${health.lastRebuilt || 'never'}`);
  Logger.log('');
  Logger.log('Sheet row counts:');

  const dataSheets = [
    'RECIPES', 'RECIPE_INGREDIENTS', 'INGREDIENTS_MASTER',
    'PANTRY_STOCK', 'PERISHABLE_STOCK', 'HOUSEHOLD_PEOPLE',
    'MEAL_HISTORY', 'RECIPE_REVIEWS',
  ];
  const summarySheets = [
    'SUMMARY_MATCH', 'SUMMARY_USEUP', 'SUMMARY_BUY_UNLOCK', 'SUMMARY_REVIEWS',
  ];

  Logger.log('  Data:');
  dataSheets.forEach(key => {
    const s = sheets[key];
    Logger.log(`    ${s.name.padEnd(25)}: ${s.rows}`);
  });
  Logger.log('  Summaries:');
  summarySheets.forEach(key => {
    const s = sheets[key];
    Logger.log(`    ${s.name.padEnd(25)}: ${s.rows}`);
  });
}

// ── Data Reset Utilities ──────────────────────────────────────

/**
 * Clears all four summary sheets.
 * Use before a rebuild if you suspect stale data is causing issues.
 * Raw data sheets are NOT affected.
 */
function clearAllSummaries() {
  const summaries = [
    { name: CONFIG.SHEETS.SUMMARY_MATCH,      key: 'SUMMARY_MATCH'      },
    { name: CONFIG.SHEETS.SUMMARY_USEUP,      key: 'SUMMARY_USEUP'      },
    { name: CONFIG.SHEETS.SUMMARY_BUY_UNLOCK, key: 'SUMMARY_BUY_UNLOCK' },
    { name: CONFIG.SHEETS.SUMMARY_REVIEWS,    key: 'SUMMARY_REVIEWS'    },
  ];

  summaries.forEach(({ name, key }) => {
    clearAndWriteSummary_(name, key, []);
    Logger.log(`Cleared: ${name}`);
  });
  Logger.log('clearAllSummaries: done');
}

/**
 * Exports a JSON snapshot of the current system state to the log.
 * Useful for debugging or sharing a system state report.
 */
function exportSystemSnapshot() {
  const status = getSystemStatus();
  Logger.log('=== System Snapshot ===');
  Logger.log(JSON.stringify(status.data, null, 2));
}

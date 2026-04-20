// ============================================================
// 06_summary_useup.gs — Project Cantor: Mise en Place
// Rebuilds the Summary_UseUp cache sheet.
//
// Summary_UseUp answers: "I have things expiring — what can
// I make with them?"
//
// Output: one row per (near-expiry ingredient × recipe) pair.
// Only recipes that actually include the near-expiry ingredient
// are included. Sorted by state urgency, then composite score.
// ============================================================

/**
 * Rebuilds Summary_UseUp from current perishable state.
 *
 * Steps:
 *   1. Identify near-expiry perishable entries (with full detail)
 *   2. Score all recipes via the matching engine
 *   3. Build an ingredient → recipes index
 *   4. Emit one row per (near-expiry ingredient, recipe) pair
 *   5. Sort: critical state first, then use_soon, then composite score desc
 *
 * @returns {{ rowsWritten: number, elapsedMs: number }}
 */
function rebuildSummaryUseUp() {
  const FN = 'rebuildSummaryUseUp';
  logInfo(FN, 'Rebuild started');
  const t0 = Date.now();

  const perishables = loadNearExpiryPerishables_();

  if (perishables.length === 0) {
    clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_USEUP, 'SUMMARY_USEUP', []);
    logInfo(FN, 'No near-expiry perishables — summary cleared');
    Logger.log('rebuildSummaryUseUp: no near-expiry items, summary cleared');
    return { rowsWritten: 0, elapsedMs: Date.now() - t0 };
  }

  // Score all recipes; getFlatIngredients_ needs the Maps so build them once
  const scoredRecipes = scoreAllRecipes();
  const recipeIngMap  = buildRecipeIngredientMap_();
  const subrecipeMap  = buildSubrecipeMap_();
  const ingToRecipes  = buildIngredientToRecipeIndex_(scoredRecipes, recipeIngMap, subrecipeMap);

  // Build output rows
  const outputRows = [];
  perishables.forEach(perishable => {
    const recipes = ingToRecipes.get(perishable.INGREDIENT_ID) || [];
    recipes.forEach(recipe => {
      outputRows.push(objectToSummaryRow_({
        PERISHABLE_INGREDIENT_ID: perishable.INGREDIENT_ID,
        INGREDIENT_NAME:          perishable.INGREDIENT_NAME,
        USE_BY_DATE:              perishable.USE_BY_DATE,
        STATE:                    perishable.STATE,
        RECIPE_ID:                recipe.RECIPE_ID,
        RECIPE_NAME:              recipe.RECIPE_NAME,
        COMPOSITE_SCORE:          recipe.COMPOSITE_SCORE,
        RESULT_GROUP:             recipe.RESULT_GROUP,
      }, 'SUMMARY_USEUP'));
    });
  });

  // Sort: critical first, use_soon second, then composite score desc within state
  const stateOrder = {
    [CONFIG.PERISHABLE_STATES.CRITICAL]: 0,
    [CONFIG.PERISHABLE_STATES.USE_SOON]: 1,
    [CONFIG.PERISHABLE_STATES.FRESH]:    2,
  };
  const colState = CONFIG.COL.SUMMARY_USEUP.STATE           - 1;
  const colScore = CONFIG.COL.SUMMARY_USEUP.COMPOSITE_SCORE - 1;

  outputRows.sort((a, b) => {
    const stateDiff = (stateOrder[a[colState]] ?? 3) - (stateOrder[b[colState]] ?? 3);
    if (stateDiff !== 0) return stateDiff;
    return Number(b[colScore]) - Number(a[colScore]);
  });

  clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_USEUP, 'SUMMARY_USEUP', outputRows);

  const elapsed = Date.now() - t0;
  logInfo(FN, `Rebuild complete: ${outputRows.length} rows in ${elapsed}ms`);
  Logger.log(`rebuildSummaryUseUp: ${outputRows.length} rows written (${elapsed}ms)`);
  return { rowsWritten: outputRows.length, elapsedMs: elapsed };
}

// ── Data Helpers ──────────────────────────────────────────────

/**
 * Returns all non-used perishable entries that are near-expiry,
 * as full objects (we need use_by_date and state for the output rows).
 * @returns {Object[]}
 */
function loadNearExpiryPerishables_() {
  const rows = getAllRows(CONFIG.SHEETS.PERISHABLE_STOCK);
  const cIngId  = CONFIG.COL.PERISHABLE_STOCK.INGREDIENT_ID   - 1;
  const cName   = CONFIG.COL.PERISHABLE_STOCK.INGREDIENT_NAME - 1;
  const cUseBy  = CONFIG.COL.PERISHABLE_STOCK.USE_BY_DATE     - 1;
  const cState  = CONFIG.COL.PERISHABLE_STOCK.STATE           - 1;

  return rows
    .filter(row => {
      const state = str(row[cState]);
      if (state === CONFIG.PERISHABLE_STATES.USED) return false;
      const urgentState  = state === CONFIG.PERISHABLE_STATES.CRITICAL ||
                           state === CONFIG.PERISHABLE_STATES.USE_SOON;
      const nearByDate   = row[cUseBy] && daysUntil(row[cUseBy]) <= CONFIG.USE_UP.USE_SOON_DAYS;
      return urgentState || nearByDate;
    })
    .map(row => ({
      INGREDIENT_ID:   Number(row[cIngId]),
      INGREDIENT_NAME: str(row[cName]),
      USE_BY_DATE:     row[cUseBy] ? formatDate(new Date(row[cUseBy])) : '',
      STATE:           str(row[cState]),
    }));
}

/**
 * Builds a Map from ingredientId to array of scored recipe results
 * that contain that ingredient (direct or via sub-recipe).
 * Uses pre-built Maps — no additional sheet reads.
 *
 * @param {Object[]} scoredRecipes
 * @param {Map}      recipeIngMap
 * @param {Map}      subrecipeMap
 * @returns {Map<number, Object[]>}
 */
function buildIngredientToRecipeIndex_(scoredRecipes, recipeIngMap, subrecipeMap) {
  const index = new Map();
  scoredRecipes.forEach(recipe => {
    getFlatIngredients_(recipe.RECIPE_ID, recipeIngMap, subrecipeMap).forEach(ing => {
      const ingId = Number(ing.INGREDIENT_ID);
      if (!index.has(ingId)) index.set(ingId, []);
      index.get(ingId).push(recipe);
    });
  });
  return index;
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Logs a readable summary of Summary_UseUp contents.
 */
function diagSummaryUseUp() {
  Logger.log('=== diagSummaryUseUp ===');
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_USEUP);
  if (rows.length === 0) {
    Logger.log('Summary_UseUp is empty — no near-expiry items or rebuild not run');
    return;
  }

  const cIngName = CONFIG.COL.SUMMARY_USEUP.INGREDIENT_NAME - 1;
  const cState   = CONFIG.COL.SUMMARY_USEUP.STATE           - 1;
  const cUseBy   = CONFIG.COL.SUMMARY_USEUP.USE_BY_DATE     - 1;
  const cRecipe  = CONFIG.COL.SUMMARY_USEUP.RECIPE_NAME     - 1;
  const cScore   = CONFIG.COL.SUMMARY_USEUP.COMPOSITE_SCORE - 1;
  const cGroup   = CONFIG.COL.SUMMARY_USEUP.RESULT_GROUP    - 1;

  Logger.log(`Total rows: ${rows.length}`);
  const uniqueIngs = [...new Set(rows.map(r => str(r[cIngName])))];
  Logger.log(`Near-expiry ingredients: ${uniqueIngs.length}`);

  uniqueIngs.forEach(name => {
    const ingRows = rows.filter(r => str(r[cIngName]) === name);
    Logger.log(`  ${name} (${ingRows[0][cState]}, use by ${ingRows[0][cUseBy]}): ${ingRows.length} recipe(s)`);
    ingRows.slice(0, 3).forEach(r =>
      Logger.log(`    [${Number(r[cScore]).toFixed(3)}] ${r[cRecipe]}  (${r[cGroup]})`)
    );
  });
}

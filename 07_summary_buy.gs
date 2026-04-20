// ============================================================
// 07_summary_buy.gs — Project Cantor: Mise en Place
// Rebuilds the Summary_BuyUnlock cache sheet.
//
// Summary_BuyUnlock answers: "What single ingredient, if bought,
// would unlock the most recipes I'm nearly ready to cook?"
//
// Scope: near-match recipes only (per spec, for performance).
//
// An ingredient UNLOCKS a near-match recipe when it is the sole
// missing ingredient (missingCount === 1). Buying it alone
// promotes the recipe to Can Cook Now.
//
// Output: one row per missing ingredient, sorted by unlock count
// descending. Pipe-delimited recipe ID list for traceability.
// ============================================================

/**
 * Rebuilds Summary_BuyUnlock from current near-match recipe set.
 *
 * Steps:
 *   1. Get all near-match scored recipes (MISSING_IDS already computed)
 *   2. Identify recipes with exactly 1 missing ingredient (sole-unlock candidates)
 *   3. Count unlock frequency per ingredient across that set
 *   4. Also count broader "contributes to" across ALL near-match recipes
 *   5. Write sorted by unlock_count desc, then contributes_count desc
 *
 * @returns {{ rowsWritten: number, elapsedMs: number }}
 */
function rebuildSummaryBuyUnlock() {
  const FN = 'rebuildSummaryBuyUnlock';
  logInfo(FN, 'Rebuild started');
  const t0 = Date.now();

  // Near-match recipes only (spec: performance constraint)
  const nearMatch = getNearMatchRecipes();

  if (nearMatch.length === 0) {
    clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_BUY_UNLOCK, 'SUMMARY_BUY_UNLOCK', []);
    logInfo(FN, 'No near-match recipes — summary cleared');
    Logger.log('rebuildSummaryBuyUnlock: no near-match recipes, summary cleared');
    return { rowsWritten: 0, elapsedMs: Date.now() - t0 };
  }

  // ── Tally unlock and contribution counts per ingredient ──
  // unlockMap:      ingredientId → [recipeIds where it is the sole missing item]
  // contributesMap: ingredientId → [recipeIds where it appears as any missing item]
  const unlockMap      = new Map(); // sole-unlock: missingCount === 1
  const contributesMap = new Map(); // appears in missing list of any near-match recipe

  nearMatch.forEach(recipe => {
    const missingIds  = recipe.MISSING_IDS || [];
    const isSoleMiss  = missingIds.length === 1;

    missingIds.forEach(ingId => {
      const id = Number(ingId);

      // Contributes to (all near-match appearances)
      if (!contributesMap.has(id)) contributesMap.set(id, []);
      contributesMap.get(id).push(recipe.RECIPE_ID);

      // Unlocks (sole missing ingredient only)
      if (isSoleMiss) {
        if (!unlockMap.has(id)) unlockMap.set(id, []);
        unlockMap.get(id).push(recipe.RECIPE_ID);
      }
    });
  });

  // ── Look up ingredient names ──────────────────────────────
  // Build a name cache from Ingredients_Master to avoid per-row lookups
  const allMasterRows = getAllRows(CONFIG.SHEETS.INGREDIENTS_MASTER);
  const cMasterId   = CONFIG.COL.INGREDIENTS_MASTER.ID   - 1;
  const cMasterName = CONFIG.COL.INGREDIENTS_MASTER.NAME - 1;
  const nameCache   = new Map();
  allMasterRows.forEach(row => {
    nameCache.set(Number(row[cMasterId]), str(row[cMasterName]));
  });

  // ── Build output rows ─────────────────────────────────────
  // Union of all ingredient IDs appearing in either map
  const allIngIds = new Set([...unlockMap.keys(), ...contributesMap.keys()]);

  const outputRows = [];
  allIngIds.forEach(ingId => {
    const unlockRecipes     = unlockMap.get(ingId)      || [];
    const contributesCount  = (contributesMap.get(ingId) || []).length;

    // Only emit rows where the ingredient unlocks at least one recipe,
    // OR contributes to multiple near-match recipes (buy priority signal)
    if (unlockRecipes.length === 0 && contributesCount < 2) return;

    outputRows.push(objectToSummaryRow_({
      INGREDIENT_ID:   ingId,
      INGREDIENT_NAME: nameCache.get(ingId) || `[id: ${ingId}]`,
      UNLOCK_COUNT:    unlockRecipes.length,
      RECIPE_IDS:      unlockRecipes.join('|'),
    }, 'SUMMARY_BUY_UNLOCK'));
  });

  // Sort: unlock count desc, then contributes count desc
  const cUnlock = CONFIG.COL.SUMMARY_BUY_UNLOCK.UNLOCK_COUNT    - 1;
  const cRecIds = CONFIG.COL.SUMMARY_BUY_UNLOCK.RECIPE_IDS      - 1;

  outputRows.sort((a, b) => {
    const unlockDiff = Number(b[cUnlock]) - Number(a[cUnlock]);
    if (unlockDiff !== 0) return unlockDiff;
    // Secondary: broader contribution (count pipe-separated IDs)
    const aContrib = str(a[cRecIds]).split('|').filter(Boolean).length;
    const bContrib = str(b[cRecIds]).split('|').filter(Boolean).length;
    return bContrib - aContrib;
  });

  clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_BUY_UNLOCK, 'SUMMARY_BUY_UNLOCK', outputRows);

  const elapsed = Date.now() - t0;
  logInfo(FN, `Rebuild complete: ${outputRows.length} rows in ${elapsed}ms`);
  Logger.log(`rebuildSummaryBuyUnlock: ${outputRows.length} ingredients written (${elapsed}ms)`);
  return { rowsWritten: outputRows.length, elapsedMs: elapsed };
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Logs the top buy-unlock candidates from the current summary.
 */
function diagSummaryBuyUnlock() {
  Logger.log('=== diagSummaryBuyUnlock ===');
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_BUY_UNLOCK);
  if (rows.length === 0) {
    Logger.log('Summary_BuyUnlock is empty — run rebuildSummaryBuyUnlock() first');
    return;
  }

  const cName   = CONFIG.COL.SUMMARY_BUY_UNLOCK.INGREDIENT_NAME - 1;
  const cUnlock = CONFIG.COL.SUMMARY_BUY_UNLOCK.UNLOCK_COUNT    - 1;
  const cRecIds = CONFIG.COL.SUMMARY_BUY_UNLOCK.RECIPE_IDS      - 1;

  Logger.log(`Total ingredients in buy-unlock list: ${rows.length}`);
  Logger.log('\nTop ingredients by unlock count:');

  rows.slice(0, 10).forEach((row, i) => {
    const unlocks     = Number(row[cUnlock]);
    const recipeCount = str(row[cRecIds]).split('|').filter(Boolean).length;
    Logger.log(
      `  ${String(i + 1).padStart(2)}. ${str(row[cName]).padEnd(30)}` +
      `  unlocks: ${unlocks}  contributes to: ${recipeCount} near-match recipes`
    );
  });
}

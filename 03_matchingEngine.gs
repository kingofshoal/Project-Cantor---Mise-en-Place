// ============================================================
// 03_matchingEngine.gs — Project Cantor: Mise en Place
// Composite score engine: data loading, sub-recipe flattening,
// per-recipe scoring, result grouping.
//
// Scoring functions live in 04_recipeRules.gs.
// This file handles data access, orchestration, and output.
//
// KEY DESIGN PRINCIPLE: All sheet data is loaded in a single
// pass per sheet and held in Maps/Sets for the scoring run.
// No per-recipe sheet reads. Critical for GAS performance.
//
// Primary public functions:
//   scoreAllRecipes([options])  — full scored array, sorted
//   getMatchResults([options])  — grouped into the four buckets
//   getCanCookNow([options])    — dashboard Cook Tonight tile
// ============================================================

// ── Public API ────────────────────────────────────────────────

/**
 * Scores all recipes against current stock state.
 * Returns a flat sorted array of result objects.
 *
 * Sorting: result group priority first (Can Cook Now → Shopping Required),
 * then composite score descending within each group.
 *
 * @param {Object}  [options]
 * @param {boolean} [options.approvedOnly=false] — restrict to Approved recipes
 * @returns {Object[]}
 */
function scoreAllRecipes(options) {
  const FN   = 'scoreAllRecipes';
  const opts = options || {};
  const approvedOnly = opts.approvedOnly === true;

  logInfo(FN, 'Scoring run started', { approvedOnly });
  const t0 = Date.now();

  // ── 1. Load all data (one pass per sheet) ─────────────────
  const recipes       = loadRecipes_(approvedOnly);
  const recipeIngMap  = buildRecipeIngredientMap_();
  const subrecipeMap  = buildSubrecipeMap_();
  const presentIds    = getPresentIngredientIds();
  const nearExpiryIds = getNearExpiryIngredientIds();

  logInfo(FN, 'Data loaded', {
    recipes:     recipes.length,
    present:     presentIds.size,
    nearExpiry:  nearExpiryIds.size,
  });

  // ── 2. Score each recipe ──────────────────────────────────
  const results = recipes.map(recipe => scoreRecipe_(
    recipe, recipeIngMap, subrecipeMap, presentIds, nearExpiryIds
  ));

  // ── 3. Sort: group priority asc, composite score desc ─────
  results.sort(sortByGroupThenScore_);

  const elapsed = Date.now() - t0;
  logInfo(FN, `Scoring complete: ${results.length} recipes scored in ${elapsed}ms`);

  return results;
}

/**
 * Returns scored results partitioned into the four result groups.
 * Each partition is already sorted by composite score descending.
 *
 * @param {Object} [options] — passed through to scoreAllRecipes
 * @returns {{
 *   canCookNow:       Object[],
 *   nearMatch:        Object[],
 *   missingAFew:      Object[],
 *   shoppingRequired: Object[]
 * }}
 */
function getMatchResults(options) {
  const all = scoreAllRecipes(options);
  return {
    canCookNow:       filterGroup_(all, CONFIG.RESULT_GROUPS.CAN_COOK_NOW),
    nearMatch:        filterGroup_(all, CONFIG.RESULT_GROUPS.NEAR_MATCH),
    missingAFew:      filterGroup_(all, CONFIG.RESULT_GROUPS.MISSING_A_FEW),
    shoppingRequired: filterGroup_(all, CONFIG.RESULT_GROUPS.SHOPPING_REQUIRED),
  };
}

/**
 * Returns only CAN_COOK_NOW results, sorted by composite score.
 * Used by the dashboard Cook Tonight tile and the 05_summary_match rebuild.
 *
 * @param {Object} [options]
 * @returns {Object[]}
 */
function getCanCookNow(options) {
  return filterGroup_(scoreAllRecipes(options), CONFIG.RESULT_GROUPS.CAN_COOK_NOW);
}

/**
 * Returns NEAR_MATCH results. Used by 07_summary_buy BuyUnlock computation,
 * which only scans near-match recipes for performance.
 *
 * @param {Object} [options]
 * @returns {Object[]}
 */
function getNearMatchRecipes(options) {
  return filterGroup_(scoreAllRecipes(options), CONFIG.RESULT_GROUPS.NEAR_MATCH);
}

// ── Per-Recipe Scorer ─────────────────────────────────────────

/**
 * Scores a single recipe object against pre-loaded stock state.
 * All Map/Set arguments must be built before calling — no sheet reads here.
 *
 * @param {Object}          recipe
 * @param {Map}             recipeIngMap  — recipeId → [{INGREDIENT_ID, IS_PRIMARY}]
 * @param {Map}             subrecipeMap  — parentId → [childIds]
 * @param {Set<number>}     presentIds
 * @param {Set<number>}     nearExpiryIds
 * @returns {Object} scored result
 */
function scoreRecipe_(recipe, recipeIngMap, subrecipeMap, presentIds, nearExpiryIds) {
  const recipeId = Number(recipe.ID);

  // Flatten sub-recipe ingredients (one level deep)
  const ingredients = getFlatIngredients_(recipeId, recipeIngMap, subrecipeMap);

  // Score components (pure functions from 04_recipeRules.gs)
  const matchResult   = computeIngredientMatchScore(ingredients, presentIds);
  const cookability   = computeCookabilityScore(
    matchResult.missingCount,
    matchResult.totalCount,
    recipe.LAST_COOKED
  );
  const allIds      = ingredients.map(i => Number(i.INGREDIENT_ID));
  const useUpBonus  = computeUseUpBonus(allIds, nearExpiryIds);
  const composite   = computeCompositeScore(matchResult.score, cookability, useUpBonus);
  const resultGroup = assignResultGroup(matchResult.missingPrimaries, matchResult.missingCount);

  return {
    RECIPE_ID:              recipeId,
    RECIPE_NAME:            str(recipe.NAME),
    STATUS:                 str(recipe.STATUS),
    TIME_BAND:              str(recipe.TIME_BAND),
    SKILL_LEVEL:            str(recipe.SKILL_LEVEL),
    LAST_COOKED:            str(recipe.LAST_COOKED),
    INGREDIENT_MATCH_SCORE: matchResult.score,
    COOKABILITY_SCORE:      cookability,
    USE_UP_BONUS:           useUpBonus,
    COMPOSITE_SCORE:        composite,
    RESULT_GROUP:           resultGroup,
    MISSING_COUNT:          matchResult.missingCount,
    MISSING_PRIMARIES:      matchResult.missingPrimaries,
    TOTAL_COUNT:            matchResult.totalCount,
    MISSING_IDS:            matchResult.missingIds,  // used by shopping list & buy-unlock
  };
}

// ── Data Loaders ──────────────────────────────────────────────

/**
 * Loads all recipe records as objects.
 * @param {boolean} approvedOnly
 * @returns {Object[]}
 */
function loadRecipes_(approvedOnly) {
  const rows = getAllRowsAsObjects(CONFIG.SHEETS.RECIPES, 'RECIPES');
  return approvedOnly
    ? rows.filter(r => str(r.STATUS) === CONFIG.RECIPE_STATUS.APPROVED)
    : rows;
}

/**
 * Builds the recipe → ingredients Map from Recipe_Ingredients sheet.
 * One read. O(1) lookup per recipe during scoring.
 *
 * @returns {Map<number, Array<{INGREDIENT_ID: number, IS_PRIMARY: boolean}>>}
 */
function buildRecipeIngredientMap_() {
  const rows         = getAllRows(CONFIG.SHEETS.RECIPE_INGREDIENTS);
  const colRecipeId  = CONFIG.COL.RECIPE_INGREDIENTS.RECIPE_ID     - 1;
  const colIngId     = CONFIG.COL.RECIPE_INGREDIENTS.INGREDIENT_ID - 1;
  const colPrimary   = CONFIG.COL.RECIPE_INGREDIENTS.IS_PRIMARY     - 1;

  const map = new Map();
  rows.forEach(row => {
    const recipeId = Number(row[colRecipeId]);
    if (!map.has(recipeId)) map.set(recipeId, []);
    map.get(recipeId).push({
      INGREDIENT_ID: Number(row[colIngId]),
      IS_PRIMARY:    row[colPrimary] === true,
    });
  });
  return map;
}

/**
 * Builds the parent → child sub-recipe Map from Recipe_Subrecipes sheet.
 * One read.
 *
 * @returns {Map<number, number[]>}
 */
function buildSubrecipeMap_() {
  const rows      = getAllRows(CONFIG.SHEETS.RECIPE_SUBRECIPES);
  const colParent = CONFIG.COL.RECIPE_SUBRECIPES.PARENT_RECIPE_ID - 1;
  const colChild  = CONFIG.COL.RECIPE_SUBRECIPES.CHILD_RECIPE_ID  - 1;

  const map = new Map();
  rows.forEach(row => {
    const parentId = Number(row[colParent]);
    if (!map.has(parentId)) map.set(parentId, []);
    map.get(parentId).push(Number(row[colChild]));
  });
  return map;
}

// ── Sub-Recipe Flattening ─────────────────────────────────────

/**
 * Returns a flattened ingredient list for a recipe, resolving
 * one level of sub-recipe children.
 *
 * Deduplication: if the same ingredient appears in both the parent
 * and a sub-recipe, the parent's entry (and IS_PRIMARY value) wins.
 *
 * Sub-recipe ingredients retain their own IS_PRIMARY value from
 * their own recipe definition — they are not promoted to primary
 * for the parent recipe.
 *
 * @param {number} recipeId
 * @param {Map}    recipeIngMap
 * @param {Map}    subrecipeMap
 * @returns {Array<{INGREDIENT_ID: number, IS_PRIMARY: boolean}>}
 */
function getFlatIngredients_(recipeId, recipeIngMap, subrecipeMap) {
  const direct = recipeIngMap.get(recipeId) || [];
  const seen   = new Set(direct.map(i => i.INGREDIENT_ID));
  const result = [...direct];

  (subrecipeMap.get(recipeId) || []).forEach(childId => {
    (recipeIngMap.get(childId) || []).forEach(ing => {
      if (!seen.has(ing.INGREDIENT_ID)) {
        seen.add(ing.INGREDIENT_ID);
        result.push(ing);
      }
    });
  });

  return result;
}

// ── Sort & Filter Helpers ─────────────────────────────────────

/**
 * Sort comparator: group priority ascending, composite score descending.
 * Used by Array.sort() — do not call directly.
 */
function sortByGroupThenScore_(a, b) {
  const order = {
    [CONFIG.RESULT_GROUPS.CAN_COOK_NOW]:      0,
    [CONFIG.RESULT_GROUPS.NEAR_MATCH]:        1,
    [CONFIG.RESULT_GROUPS.MISSING_A_FEW]:     2,
    [CONFIG.RESULT_GROUPS.SHOPPING_REQUIRED]: 3,
  };
  const groupDiff = (order[a.RESULT_GROUP] ?? 3) - (order[b.RESULT_GROUP] ?? 3);
  if (groupDiff !== 0) return groupDiff;
  return b.COMPOSITE_SCORE - a.COMPOSITE_SCORE;
}

/**
 * Filters a scored results array to a single result group.
 * @param {Object[]} results
 * @param {string}   group — CONFIG.RESULT_GROUPS value
 * @returns {Object[]}
 */
function filterGroup_(results, group) {
  return results.filter(r => r.RESULT_GROUP === group);
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Runs a full scoring pass and logs a summary to the GAS editor.
 * Shows top 5 recipes per group and overall score distribution.
 * Safe to run at any time — read-only, no sheet modifications.
 */
function diagMatchingEngine() {
  Logger.log('=== diagMatchingEngine ===');
  Logger.log('Running full scoring pass...');

  const results = scoreAllRecipes();

  if (results.length === 0) {
    Logger.log('No recipes to score. Add some recipes and stock first.');
    return;
  }

  const groups = {
    [CONFIG.RESULT_GROUPS.CAN_COOK_NOW]:      [],
    [CONFIG.RESULT_GROUPS.NEAR_MATCH]:        [],
    [CONFIG.RESULT_GROUPS.MISSING_A_FEW]:     [],
    [CONFIG.RESULT_GROUPS.SHOPPING_REQUIRED]: [],
  };
  results.forEach(r => {
    if (groups[r.RESULT_GROUP]) groups[r.RESULT_GROUP].push(r);
  });

  Logger.log(`Total recipes scored: ${results.length}\n`);

  Object.entries(groups).forEach(([group, items]) => {
    Logger.log(`── ${group} (${items.length} recipes) ──`);
    items.slice(0, 5).forEach(r => {
      const parts = [
        `  [${r.COMPOSITE_SCORE.toFixed(3)}]`,
        r.RECIPE_NAME.padEnd(30),
        `match:${r.INGREDIENT_MATCH_SCORE.toFixed(2)}`,
        `cook:${r.COOKABILITY_SCORE.toFixed(2)}`,
        `uu:${r.USE_UP_BONUS.toFixed(0)}`,
        `missing:${r.MISSING_COUNT}(${r.MISSING_PRIMARIES}p)`,
      ];
      Logger.log(parts.join('  '));
    });
    if (items.length > 5) Logger.log(`  ... and ${items.length - 5} more`);
    Logger.log('');
  });

  // Score distribution
  const scores = results.map(r => r.COMPOSITE_SCORE);
  const avg    = scores.reduce((a, b) => a + b, 0) / scores.length;
  const max_s  = Math.max(...scores);
  const min_s  = Math.min(...scores);
  Logger.log(`Score range: ${min_s.toFixed(3)} – ${max_s.toFixed(3)}  avg: ${avg.toFixed(3)}`);

  // Use-up flag count
  const withUseUp = results.filter(r => r.USE_UP_BONUS > 0).length;
  Logger.log(`Recipes with use-up bonus: ${withUseUp}`);

  Logger.log('=== diagMatchingEngine complete ===');
}

/**
 * Scores a single recipe by ID and logs the full breakdown.
 * Useful for debugging a specific recipe's score.
 * @param {number} recipeId
 */
function diagScoreRecipe(recipeId) {
  Logger.log(`=== diagScoreRecipe (id: ${recipeId}) ===`);

  const recipe = getRecipeById(recipeId);
  if (!recipe) {
    Logger.log(`Recipe ${recipeId} not found`);
    return;
  }

  const recipeIngMap  = buildRecipeIngredientMap_();
  const subrecipeMap  = buildSubrecipeMap_();
  const presentIds    = getPresentIngredientIds();
  const nearExpiryIds = getNearExpiryIngredientIds();

  const result = scoreRecipe_(recipe, recipeIngMap, subrecipeMap, presentIds, nearExpiryIds);

  Logger.log(`Name:             ${result.RECIPE_NAME}`);
  Logger.log(`Status:           ${result.STATUS}`);
  Logger.log(`Last cooked:      ${result.LAST_COOKED || 'never'}`);
  Logger.log(`Result group:     ${result.RESULT_GROUP}`);
  Logger.log(`Composite score:  ${result.COMPOSITE_SCORE}`);
  Logger.log(`  Match score:    ${result.INGREDIENT_MATCH_SCORE} (× ${CONFIG.WEIGHTS.INGREDIENT_MATCH})`);
  Logger.log(`  Cookability:    ${result.COOKABILITY_SCORE} (× ${CONFIG.WEIGHTS.COOKABILITY})`);
  Logger.log(`  Use-up bonus:   ${result.USE_UP_BONUS} (× ${CONFIG.WEIGHTS.USE_UP_BONUS})`);
  Logger.log(`Ingredients:      ${result.TOTAL_COUNT} total, ${result.MISSING_COUNT} missing`);
  Logger.log(`  Missing primary:${result.MISSING_PRIMARIES}`);
  if (result.MISSING_IDS.length > 0) {
    Logger.log(`  Missing IDs:    ${result.MISSING_IDS.join(', ')}`);
  }
}

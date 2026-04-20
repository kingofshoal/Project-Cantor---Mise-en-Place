// ============================================================
// 04_recipeRules.gs — Project Cantor: Mise en Place
// Pure scoring functions for the matching engine.
//
// No sheet access in this file. All functions are deterministic
// given their inputs — makes them independently testable via
// diagRecipeRules() without needing any live data.
//
// Called by 03_matchingEngine.gs.
// ============================================================

// ── Ingredient Match Score ────────────────────────────────────

/**
 * Computes the ingredient match score component (input to the 60% weight).
 *
 * Formula:
 *   primaryRatio = primaryMatches / totalPrimaries  (1.0 if no primaries defined)
 *   allRatio     = allMatches / totalIngredients    (1.0 if recipe has no ingredients)
 *   score        = (primaryRatio × MATCH_PRIMARY_WEIGHT) + (allRatio × MATCH_ALL_WEIGHT)
 *
 * @param {Array<{INGREDIENT_ID: number, IS_PRIMARY: boolean}>} recipeIngredients
 * @param {Set<number>} presentIds — ingredient IDs currently in stock
 * @returns {{
 *   score:           number,   // 0.0–1.0
 *   missingCount:    number,   // absolute count of missing ingredients
 *   missingPrimaries:number,   // absolute count of missing primary ingredients
 *   totalCount:      number,
 *   totalPrimaries:  number,
 *   missingIds:      number[]  // IDs of missing ingredients (for shopping list use)
 * }}
 */
function computeIngredientMatchScore(recipeIngredients, presentIds) {
  if (!recipeIngredients || recipeIngredients.length === 0) {
    return {
      score: 0, missingCount: 0, missingPrimaries: 0,
      totalCount: 0, totalPrimaries: 0, missingIds: [],
    };
  }

  const totalCount     = recipeIngredients.length;
  const totalPrimaries = recipeIngredients.filter(i => i.IS_PRIMARY === true).length;

  let primaryMatches = 0;
  let allMatches     = 0;
  const missingIds   = [];

  recipeIngredients.forEach(ing => {
    const id = Number(ing.INGREDIENT_ID);
    if (presentIds.has(id)) {
      allMatches++;
      if (ing.IS_PRIMARY === true) primaryMatches++;
    } else {
      missingIds.push(id);
    }
  });

  const missingCount     = totalCount - allMatches;
  const missingPrimaries = totalPrimaries - primaryMatches;

  const primaryRatio = totalPrimaries > 0
    ? primaryMatches / totalPrimaries
    : 1.0; // recipe with no primaries defined: treat as fully matched

  const allRatio = totalCount > 0
    ? allMatches / totalCount
    : 1.0;

  const score = round(
    (primaryRatio * CONFIG.WEIGHTS.MATCH_PRIMARY_WEIGHT) +
    (allRatio     * CONFIG.WEIGHTS.MATCH_ALL_WEIGHT),
    4
  );

  return { score, missingCount, missingPrimaries, totalCount, totalPrimaries, missingIds };
}

// ── Cookability Score ─────────────────────────────────────────

/**
 * Computes the cookability score component (input to the 25% weight).
 *
 * Cookability = (deltaScore × COOKABILITY_DELTA) + (recencyScore × COOKABILITY_RECENCY)
 *
 * deltaScore:
 *   Rewards recipes where few ingredients are missing in absolute terms.
 *   A recipe missing 1 of 20 scores higher than one missing 1 of 4,
 *   even if both show the same ingredient match ratio.
 *   Formula: max(0, 1 - missingCount/totalCount)
 *
 * recencyScore:
 *   Penalises recently cooked recipes to avoid repetition.
 *   Linear decay: 0.0 (cooked today) → 1.0 (cooked DECAY_DAYS+ ago or never)
 *   See recencyScore() in 01_util.gs.
 *
 * @param {number}      missingCount
 * @param {number}      totalCount
 * @param {Date|string} lastCookedDate — empty/null means never cooked
 * @returns {number} 0.0 – 1.0
 */
function computeCookabilityScore(missingCount, totalCount, lastCookedDate) {
  const delta   = ingredientDeltaScore(missingCount, totalCount);
  const recency = recencyScore(lastCookedDate);

  return round(
    (delta   * CONFIG.WEIGHTS.COOKABILITY_DELTA)   +
    (recency * CONFIG.WEIGHTS.COOKABILITY_RECENCY),
    4
  );
}

// ── Use-Up Bonus ──────────────────────────────────────────────

/**
 * Computes the use-up bonus component (input to the 15% weight).
 *
 * Returns BONUS_VALUE (1.0) if any ingredient in the recipe is
 * near-expiry, 0.0 otherwise.
 *
 * The bonus is binary by design: a recipe that uses up even one
 * near-expiry item should be surfaced strongly. Gradual bonuses
 * would be swamped by the match and cookability components.
 *
 * @param {number[]}    ingredientIds  — all IDs in the recipe (post-flatten)
 * @param {Set<number>} nearExpiryIds  — from getNearExpiryIngredientIds()
 * @returns {number} 0.0 or CONFIG.USE_UP.BONUS_VALUE (1.0)
 */
function computeUseUpBonus(ingredientIds, nearExpiryIds) {
  if (!nearExpiryIds || nearExpiryIds.size === 0) return 0;
  if (!ingredientIds || ingredientIds.length === 0) return 0;
  const hasNearExpiry = ingredientIds.some(id => nearExpiryIds.has(Number(id)));
  return hasNearExpiry ? CONFIG.USE_UP.BONUS_VALUE : 0;
}

// ── Composite Score ───────────────────────────────────────────

/**
 * Combines the three score components into a weighted composite.
 *
 * composite = (matchScore      × INGREDIENT_MATCH)  // 0.60
 *           + (cookabilityScore × COOKABILITY)       // 0.25
 *           + (useUpBonus       × USE_UP_BONUS)      // 0.15
 *
 * Maximum possible score is 1.0 (all ingredients present, never
 * cooked recently, at least one near-expiry item used).
 *
 * @param {number} matchScore
 * @param {number} cookabilityScore
 * @param {number} useUpBonus       — 0.0 or 1.0
 * @returns {number} 0.0 – 1.0
 */
function computeCompositeScore(matchScore, cookabilityScore, useUpBonus) {
  return round(
    (matchScore       * CONFIG.WEIGHTS.INGREDIENT_MATCH) +
    (cookabilityScore * CONFIG.WEIGHTS.COOKABILITY)      +
    (useUpBonus       * CONFIG.WEIGHTS.USE_UP_BONUS),
    4
  );
}

// ── Result Group Assignment ───────────────────────────────────

/**
 * Assigns a result group based on missing ingredient counts.
 * Conditions are evaluated in priority order; first match wins.
 *
 * CAN_COOK_NOW:
 *   missingPrimaries === 0 AND missingCount === 0
 *   (nothing missing — ready to cook as-is)
 *
 * NEAR_MATCH (two paths):
 *   Path A: missingPrimaries === 0, some secondaries missing
 *           (all essentials present; missing items are optional)
 *   Path B: missingPrimaries === 1 AND missingCount <= 3
 *           (one key ingredient short but otherwise close)
 *
 * MISSING_A_FEW:
 *   missingCount <= 3 (2–3 total missing, doesn't qualify above)
 *
 * SHOPPING_REQUIRED:
 *   missingCount >= 4 (needs a meaningful shop)
 *
 * @param {number} missingPrimaries
 * @param {number} missingCount     — total ingredients missing
 * @returns {string} CONFIG.RESULT_GROUPS value
 */
function assignResultGroup(missingPrimaries, missingCount) {
  if (missingPrimaries === 0 && missingCount === 0) {
    return CONFIG.RESULT_GROUPS.CAN_COOK_NOW;
  }
  if (missingPrimaries === 0) {
    return CONFIG.RESULT_GROUPS.NEAR_MATCH;       // path A
  }
  if (missingPrimaries === 1 && missingCount <= 3) {
    return CONFIG.RESULT_GROUPS.NEAR_MATCH;       // path B
  }
  if (missingCount <= 3) {
    return CONFIG.RESULT_GROUPS.MISSING_A_FEW;
  }
  return CONFIG.RESULT_GROUPS.SHOPPING_REQUIRED;
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Exercises all scoring functions with synthetic data.
 * Run from the GAS editor to verify rule logic without needing live data.
 */
function diagRecipeRules() {
  Logger.log('=== diagRecipeRules ===');

  // ── Ingredient match score ──────────────────────────────────
  Logger.log('\n-- computeIngredientMatchScore --');

  const presentIds = new Set([1, 2, 3]);

  const perfect = [
    { INGREDIENT_ID: 1, IS_PRIMARY: true  },
    { INGREDIENT_ID: 2, IS_PRIMARY: true  },
    { INGREDIENT_ID: 3, IS_PRIMARY: false },
  ];
  const r1 = computeIngredientMatchScore(perfect, presentIds);
  Logger.log('All present (3/3):            score=' + r1.score +
    ' missing=' + r1.missingCount + ' missingPrimaries=' + r1.missingPrimaries);

  const missingSecondary = [
    { INGREDIENT_ID: 1, IS_PRIMARY: true  },
    { INGREDIENT_ID: 2, IS_PRIMARY: true  },
    { INGREDIENT_ID: 3, IS_PRIMARY: false },
    { INGREDIENT_ID: 4, IS_PRIMARY: false }, // absent
  ];
  const r2 = computeIngredientMatchScore(missingSecondary, presentIds);
  Logger.log('Missing 1 secondary (3/4):    score=' + r2.score +
    ' missing=' + r2.missingCount + ' missingPrimaries=' + r2.missingPrimaries);

  const missingPrimary = [
    { INGREDIENT_ID: 1, IS_PRIMARY: true  },
    { INGREDIENT_ID: 2, IS_PRIMARY: true  },
    { INGREDIENT_ID: 5, IS_PRIMARY: true  }, // absent
    { INGREDIENT_ID: 3, IS_PRIMARY: false },
  ];
  const r3 = computeIngredientMatchScore(missingPrimary, presentIds);
  Logger.log('Missing 1 primary (3/4):      score=' + r3.score +
    ' missing=' + r3.missingCount + ' missingPrimaries=' + r3.missingPrimaries);

  // ── Cookability score ───────────────────────────────────────
  Logger.log('\n-- computeCookabilityScore --');
  Logger.log('0 missing, never cooked:     ' + computeCookabilityScore(0, 5, null));
  Logger.log('1 missing of 5, never cooked:' + computeCookabilityScore(1, 5, null));
  Logger.log('0 missing, cooked today:     ' + computeCookabilityScore(0, 5, today()));
  Logger.log('0 missing, cooked 15d ago:   ' +
    computeCookabilityScore(0, 5, new Date(Date.now() - 15 * 86400000)));
  Logger.log('0 missing, cooked 30d ago:   ' +
    computeCookabilityScore(0, 5, new Date(Date.now() - 30 * 86400000)));

  // ── Use-up bonus ────────────────────────────────────────────
  Logger.log('\n-- computeUseUpBonus --');
  const nearExpiry = new Set([4, 6]);
  Logger.log('Overlap with near-expiry:     ' + computeUseUpBonus([1, 2, 4], nearExpiry));
  Logger.log('No overlap:                   ' + computeUseUpBonus([1, 2, 3], nearExpiry));
  Logger.log('Empty nearExpiry:             ' + computeUseUpBonus([1, 2, 4], new Set()));

  // ── Composite score ─────────────────────────────────────────
  Logger.log('\n-- computeCompositeScore --');
  Logger.log('Perfect score (1, 1, 1):     ' + computeCompositeScore(1, 1, 1));
  Logger.log('Typical (0.85, 0.72, 0):     ' + computeCompositeScore(0.85, 0.72, 0));
  Logger.log('Typical (0.85, 0.72, 1):     ' + computeCompositeScore(0.85, 0.72, 1));
  Logger.log('Poor match (0.3, 0.5, 0):    ' + computeCompositeScore(0.3, 0.5, 0));

  // ── Result group assignment ─────────────────────────────────
  Logger.log('\n-- assignResultGroup --');
  const cases = [
    [0, 0], [0, 1], [0, 3],
    [1, 1], [1, 3], [1, 4],
    [2, 2], [2, 3], [2, 5],
  ];
  cases.forEach(([mp, mc]) => {
    Logger.log(`missingPrimaries=${mp} missingCount=${mc} → ${assignResultGroup(mp, mc)}`);
  });

  Logger.log('\n=== diagRecipeRules complete ===');
}

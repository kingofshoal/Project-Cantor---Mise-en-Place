// ============================================================
// 10_api_dashboard.gs — Project Cantor: Mise en Place
// Dashboard data endpoints called by the SPA via google.script.run.
//
// All functions return a standard envelope:
//   { success: true,  data: {...} }
//   { success: false, error: 'message' }
//
// These functions READ from summary sheets — they do not rebuild.
// Call rebuildAllSummaries() (12_admin.gs) separately before
// serving the dashboard if data may be stale.
// ============================================================

// ── Response Envelope ─────────────────────────────────────────

/**
 * Wraps a successful result in the standard API envelope.
 * @param {any} data
 * @returns {{ success: true, data: any }}
 */
function ok_(data) {
  return { success: true, data: data };
}

/**
 * Wraps an error in the standard API envelope.
 * @param {string} message
 * @param {string} [source]
 * @returns {{ success: false, error: string }}
 */
function err_(message, source) {
  if (source) logError(source, message);
  return { success: false, error: message };
}

// ── Dashboard Endpoints ───────────────────────────────────────

/**
 * Master dashboard endpoint. Returns all four tile datasets
 * and a system summary in a single call.
 *
 * Called on dashboard load. Reads from all four summary sheets.
 *
 * @param {Object} [options]
 * @param {number} [options.cookTonightLimit=8]  — max Cook Tonight results
 * @param {number} [options.useUpLimit=6]        — max Use Up results
 * @param {number} [options.buyLimit=8]          — max Buy results
 * @param {number} [options.recentLimit=5]       — max Recent results
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function getDashboardData(options) {
  const FN = 'getDashboardData';
  try {
    const opts = options || {};
    return ok_({
      cookTonight:  getCookTonightTile_(opts.cookTonightLimit || 8),
      useUp:        getUseUpTile_(opts.useUpLimit || 6),
      buy:          getBuyTile_(opts.buyLimit || 8),
      recent:       getRecentTile_(opts.recentLimit || 5),
      matchSummary: getMatchSummary_(),
      lastRebuilt:  getLastRebuiltDate_(),
    });
  } catch (e) {
    return err_(`getDashboardData failed: ${e.message}`, FN);
  }
}

/**
 * Cook Tonight tile endpoint.
 * Returns top N recipes from the Can Cook Now group,
 * sorted by composite score descending.
 *
 * @param {number} [limit=8]
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
function getCookTonight(limit) {
  const FN = 'getCookTonight';
  try {
    return ok_(getCookTonightTile_(limit || 8));
  } catch (e) {
    return err_(`getCookTonight failed: ${e.message}`, FN);
  }
}

/**
 * Use Up tile endpoint.
 * Returns near-expiry ingredient groups with associated recipes.
 *
 * @param {number} [limit=6]
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
function getUseUpTile(limit) {
  const FN = 'getUseUpTile';
  try {
    return ok_(getUseUpTile_(limit || 6));
  } catch (e) {
    return err_(`getUseUpTile failed: ${e.message}`, FN);
  }
}

/**
 * Buy tile endpoint.
 * Returns top N ingredients by unlock count.
 *
 * @param {number} [limit=8]
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
function getBuyTile(limit) {
  const FN = 'getBuyTile';
  try {
    return ok_(getBuyTile_(limit || 8));
  } catch (e) {
    return err_(`getBuyTile failed: ${e.message}`, FN);
  }
}

/**
 * Recipe search endpoint.
 * Searches Summary_Recipe_Match (name/tag) combined with live
 * ingredient name lookup for ingredient-based searches.
 *
 * @param {Object} params
 * @param {string} [params.query]         — free text (name or ingredient)
 * @param {string} [params.status]        — 'Testing' | 'Approved'
 * @param {boolean}[params.familyApproved]— filter to Family Approved only
 * @param {string} [params.timeBand]      — 'Quick' | 'Standard' | 'Project'
 * @param {string} [params.skillLevel]    — 'Easy' | 'Moderate' | 'Challenging'
 * @param {string} [params.resultGroup]   — CONFIG.RESULT_GROUPS value
 * @param {number} [params.limit=50]
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
/**
 * Returns all ingredients from Ingredients_Master for autocomplete.
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
function getIngredientMasterList() {
  const FN = 'getIngredientMasterList';
  try {
    const rows  = getAllRows(CONFIG.SHEETS.INGREDIENTS_MASTER);
    const cId   = CONFIG.COL.INGREDIENTS_MASTER.ID           - 1;
    const cName = CONFIG.COL.INGREDIENTS_MASTER.NAME         - 1;
    const cCat  = CONFIG.COL.INGREDIENTS_MASTER.CATEGORY     - 1;
    const cTax  = CONFIG.COL.INGREDIENTS_MASTER.TAXONOMY_TAG - 1;
    return ok_(rows.map(r => ({
      id:          Number(r[cId]),
      name:        str(r[cName]),
      category:    str(r[cCat]),
      taxonomyTag: str(r[cTax]),
    })));
  } catch (e) {
    return err_(`${FN} failed: ${e.message}`, FN);
  }
}

/**
 * Returns active household members for reviewer dropdowns.
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
/**
 * Resolves or creates an ingredient by name, returning {id, name}.
 * Used by the stock forms to resolve free-text ingredient entry.
 * @param {string} rawName
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function resolveIngredientByName(rawName) {
  const FN = 'resolveIngredientByName';
  try {
    if (!str(rawName)) return err_('rawName is required', FN);
    const id  = resolveOrCreateIngredient_(rawName);
    const ing = getIngredientById(id);
    return ok_({ id, name: ing ? str(ing.NAME) : str(rawName) });
  } catch (e) {
    return err_(`${FN} failed: ${e.message}`, FN);
  }
}

function getHouseholdPeople() {
  const FN = 'getHouseholdPeople';
  try {
    const rows    = getAllRows(CONFIG.SHEETS.HOUSEHOLD_PEOPLE);
    const cId     = CONFIG.COL.HOUSEHOLD_PEOPLE.ID        - 1;
    const cName   = CONFIG.COL.HOUSEHOLD_PEOPLE.NAME      - 1;
    const cActive = CONFIG.COL.HOUSEHOLD_PEOPLE.IS_ACTIVE - 1;
    return ok_(rows
      .filter(r => r[cActive] === true)
      .map(r => ({ id: Number(r[cId]), name: str(r[cName]) }))
    );
  } catch (e) {
    return err_(`${FN} failed: ${e.message}`, FN);
  }
}

/**
 * Returns current pantry stock for the stock management view.
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
function getPantryStockList() {
  const FN = 'getPantryStockList';
  try {
    const rows  = getAllRows(CONFIG.SHEETS.PANTRY_STOCK);
    const cId   = CONFIG.COL.PANTRY_STOCK.ID              - 1;
    const cIngId= CONFIG.COL.PANTRY_STOCK.INGREDIENT_ID   - 1;
    const cName = CONFIG.COL.PANTRY_STOCK.INGREDIENT_NAME - 1;
    const cStal = CONFIG.COL.PANTRY_STOCK.IS_STAPLE       - 1;
    const cOos  = CONFIG.COL.PANTRY_STOCK.OUT_OF_STOCK    - 1;
    const cUpd  = CONFIG.COL.PANTRY_STOCK.LAST_UPDATED    - 1;
    return ok_(rows.map(r => ({
      id:             Number(r[cId]),
      ingredientId:   Number(r[cIngId]),
      ingredientName: str(r[cName]),
      isStaple:       r[cStal] === true,
      outOfStock:     r[cOos]  === true,
      lastUpdated:    str(r[cUpd]),
    })));
  } catch (e) {
    return err_(`${FN} failed: ${e.message}`, FN);
  }
}

/**
 * Returns active perishable stock entries for the stock management view.
 * @returns {{ success: boolean, data?: Object[], error?: string }}
 */
function getPerishableStockList() {
  const FN = 'getPerishableStockList';
  try {
    const rows  = getAllRows(CONFIG.SHEETS.PERISHABLE_STOCK);
    const cId   = CONFIG.COL.PERISHABLE_STOCK.ID              - 1;
    const cIngId= CONFIG.COL.PERISHABLE_STOCK.INGREDIENT_ID   - 1;
    const cName = CONFIG.COL.PERISHABLE_STOCK.INGREDIENT_NAME - 1;
    const cUseBy= CONFIG.COL.PERISHABLE_STOCK.USE_BY_DATE     - 1;
    const cState= CONFIG.COL.PERISHABLE_STOCK.STATE           - 1;
    return ok_(rows
      .filter(r => str(r[cState]) !== CONFIG.PERISHABLE_STATES.USED)
      .map(r => ({
        id:             Number(r[cId]),
        ingredientId:   Number(r[cIngId]),
        ingredientName: str(r[cName]),
        useByDate:      r[cUseBy] ? formatDate(new Date(r[cUseBy])) : '',
        state:          str(r[cState]),
      }))
    );
  } catch (e) {
    return err_(`${FN} failed: ${e.message}`, FN);
  }
}

function searchRecipes(params) {
  const FN = 'searchRecipes';
  try {
    const p     = params || {};
    const limit = p.limit || 50;

    // Build base result set from Summary_Recipe_Match
    const matchRows = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
    const cRecipeId = CONFIG.COL.SUMMARY_MATCH.RECIPE_ID       - 1;
    const cName     = CONFIG.COL.SUMMARY_MATCH.RECIPE_NAME     - 1;
    const cGroup    = CONFIG.COL.SUMMARY_MATCH.RESULT_GROUP    - 1;
    const cScore    = CONFIG.COL.SUMMARY_MATCH.COMPOSITE_SCORE - 1;
    const cMissing  = CONFIG.COL.SUMMARY_MATCH.MISSING_COUNT   - 1;

    // Load review signals for Family Approved filter
    const reviewMap = buildReviewSignalMap_();

    // Load recipe raw data for status / time band / skill level / tags filter
    const recipeRaw = buildRecipeRawMap_();

    // Build ingredient name index for ingredient-based search
    const ingNameIndex = p.query ? buildIngredientNameIndex_() : null;

    const query = p.query ? p.query.trim().toLowerCase() : '';

    let results = matchRows
      .map(row => {
        const recipeId   = Number(row[cRecipeId]);
        const recipeName = str(row[cName]);
        const raw        = recipeRaw.get(recipeId) || {};
        const review     = reviewMap.get(recipeId) || {};

        return {
          recipeId,
          recipeName,
          resultGroup:    str(row[cGroup]),
          compositeScore: Number(row[cScore]),
          missingCount:   Number(row[cMissing]),
          status:         str(raw.STATUS),
          timeBand:       str(raw.TIME_BAND),
          skillLevel:     str(raw.SKILL_LEVEL),
          tags:           str(raw.TAGS),
          familyApproved: review.familyApproved || false,
          avgRating:      review.avgRating || null,
        };
      })
      .filter(r => {
        // Status filter
        if (p.status && r.status !== p.status) return false;
        // Family Approved filter
        if (p.familyApproved === true && !r.familyApproved) return false;
        // Time band filter
        if (p.timeBand && r.timeBand !== p.timeBand) return false;
        // Skill level filter
        if (p.skillLevel && r.skillLevel !== p.skillLevel) return false;
        // Result group filter
        if (p.resultGroup && r.resultGroup !== p.resultGroup) return false;
        // Text query: match recipe name, tags, or ingredient names
        if (query) {
          const nameMatch = r.recipeName.toLowerCase().includes(query);
          const tagMatch  = r.tags.toLowerCase().includes(query);
          const ingMatch  = ingNameIndex
            ? doesRecipeUseIngredient_(r.recipeId, query, ingNameIndex)
            : false;
          if (!nameMatch && !tagMatch && !ingMatch) return false;
        }
        return true;
      });

    // Sort by composite score desc
    results.sort((a, b) => b.compositeScore - a.compositeScore);

    return ok_(results.slice(0, limit));
  } catch (e) {
    return err_(`searchRecipes failed: ${e.message}`, FN);
  }
}

// ── Tile Data Builders ────────────────────────────────────────

/**
 * Reads Summary_Recipe_Match and returns top N CAN_COOK_NOW results.
 * @param {number} limit
 * @returns {Object[]}
 */
function getCookTonightTile_(limit) {
  const rows   = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
  const cId    = CONFIG.COL.SUMMARY_MATCH.RECIPE_ID       - 1;
  const cName  = CONFIG.COL.SUMMARY_MATCH.RECIPE_NAME     - 1;
  const cGroup = CONFIG.COL.SUMMARY_MATCH.RESULT_GROUP    - 1;
  const cScore = CONFIG.COL.SUMMARY_MATCH.COMPOSITE_SCORE - 1;
  const cMatch = CONFIG.COL.SUMMARY_MATCH.INGREDIENT_MATCH_SCORE - 1;
  const cCook  = CONFIG.COL.SUMMARY_MATCH.COOKABILITY_SCORE     - 1;

  return rows
    .filter(r => str(r[cGroup]) === CONFIG.RESULT_GROUPS.CAN_COOK_NOW)
    .sort((a, b) => Number(b[cScore]) - Number(a[cScore]))
    .slice(0, limit)
    .map(r => ({
      recipeId:           Number(r[cId]),
      recipeName:         str(r[cName]),
      compositeScore:     Number(r[cScore]),
      matchScore:         Number(r[cMatch]),
      cookabilityScore:   Number(r[cCook]),
    }));
}

/**
 * Reads Summary_UseUp and returns grouped use-up data.
 * Groups by ingredient, returning up to limit rows total.
 * @param {number} limit — max total rows
 * @returns {Object[]}
 */
function getUseUpTile_(limit) {
  const rows    = getAllRows(CONFIG.SHEETS.SUMMARY_USEUP);
  const cIngId  = CONFIG.COL.SUMMARY_USEUP.PERISHABLE_INGREDIENT_ID - 1;
  const cIngNm  = CONFIG.COL.SUMMARY_USEUP.INGREDIENT_NAME          - 1;
  const cUseBy  = CONFIG.COL.SUMMARY_USEUP.USE_BY_DATE              - 1;
  const cState  = CONFIG.COL.SUMMARY_USEUP.STATE                    - 1;
  const cRecId  = CONFIG.COL.SUMMARY_USEUP.RECIPE_ID                - 1;
  const cRecNm  = CONFIG.COL.SUMMARY_USEUP.RECIPE_NAME              - 1;
  const cScore  = CONFIG.COL.SUMMARY_USEUP.COMPOSITE_SCORE          - 1;
  const cGroup  = CONFIG.COL.SUMMARY_USEUP.RESULT_GROUP             - 1;

  return rows.slice(0, limit).map(r => ({
    ingredientId:   Number(r[cIngId]),
    ingredientName: str(r[cIngNm]),
    useByDate:      str(r[cUseBy]),
    state:          str(r[cState]),
    recipeId:       Number(r[cRecId]),
    recipeName:     str(r[cRecNm]),
    compositeScore: Number(r[cScore]),
    resultGroup:    str(r[cGroup]),
  }));
}

/**
 * Reads Summary_BuyUnlock and returns top N ingredients by unlock count.
 * @param {number} limit
 * @returns {Object[]}
 */
function getBuyTile_(limit) {
  const rows   = getAllRows(CONFIG.SHEETS.SUMMARY_BUY_UNLOCK);
  const cId    = CONFIG.COL.SUMMARY_BUY_UNLOCK.INGREDIENT_ID   - 1;
  const cName  = CONFIG.COL.SUMMARY_BUY_UNLOCK.INGREDIENT_NAME - 1;
  const cCount = CONFIG.COL.SUMMARY_BUY_UNLOCK.UNLOCK_COUNT    - 1;
  const cIds   = CONFIG.COL.SUMMARY_BUY_UNLOCK.RECIPE_IDS      - 1;

  return rows.slice(0, limit).map(r => ({
    ingredientId:  Number(r[cId]),
    ingredientName:str(r[cName]),
    unlockCount:   Number(r[cCount]),
    recipeIds:     str(r[cIds]).split('|').filter(Boolean).map(Number),
  }));
}

/**
 * Reads Meal_History (most recent N) and joins Review_Signals.
 * @param {number} limit
 * @returns {Object[]}
 */
function getRecentTile_(limit) {
  const rows   = getAllRows(CONFIG.SHEETS.MEAL_HISTORY);
  const cId    = CONFIG.COL.MEAL_HISTORY.RECIPE_ID    - 1;
  const cName  = CONFIG.COL.MEAL_HISTORY.RECIPE_NAME  - 1;
  const cDate  = CONFIG.COL.MEAL_HISTORY.COOKED_DATE  - 1;
  const cNotes = CONFIG.COL.MEAL_HISTORY.NOTES        - 1;

  const reviewMap = buildReviewSignalMap_();

  // Most recent first
  const sorted = [...rows]
    .sort((a, b) => {
      const dA = a[cDate] ? new Date(a[cDate]) : new Date(0);
      const dB = b[cDate] ? new Date(b[cDate]) : new Date(0);
      return dB - dA;
    })
    .slice(0, limit);

  return sorted.map(r => {
    const recipeId = Number(r[cId]);
    const review   = reviewMap.get(recipeId) || {};
    return {
      recipeId,
      recipeName:    str(r[cName]),
      cookedDate:    str(r[cDate]),
      notes:         str(r[cNotes]),
      avgRating:     review.avgRating     || null,
      familyApproved:review.familyApproved || false,
      reviewCount:   review.reviewCount   || 0,
    };
  });
}

/**
 * Returns a count breakdown of recipes by result group.
 * @returns {Object}
 */
function getMatchSummary_() {
  const rows   = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
  const cGroup = CONFIG.COL.SUMMARY_MATCH.RESULT_GROUP - 1;

  const summary = { total: rows.length };
  Object.values(CONFIG.RESULT_GROUPS).forEach(g => { summary[g] = 0; });
  rows.forEach(r => {
    const g = str(r[cGroup]);
    if (summary[g] !== undefined) summary[g]++;
  });
  return summary;
}

/**
 * Returns the last rebuilt date from the first row of Summary_Recipe_Match.
 * @returns {string}
 */
function getLastRebuiltDate_() {
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
  if (rows.length === 0) return '';
  return str(rows[0][CONFIG.COL.SUMMARY_MATCH.LAST_REBUILT - 1]);
}

// ── Index Builders (search support) ──────────────────────────

/**
 * Builds a Map<recipeId, {STATUS, TIME_BAND, SKILL_LEVEL, TAGS}> from Recipes sheet.
 * @returns {Map<number, Object>}
 */
function buildRecipeRawMap_() {
  const rows = getAllRows(CONFIG.SHEETS.RECIPES);
  const cId     = CONFIG.COL.RECIPES.ID          - 1;
  const cStatus = CONFIG.COL.RECIPES.STATUS       - 1;
  const cBand   = CONFIG.COL.RECIPES.TIME_BAND   - 1;
  const cSkill  = CONFIG.COL.RECIPES.SKILL_LEVEL - 1;
  const cTags   = CONFIG.COL.RECIPES.TAGS        - 1;

  const map = new Map();
  rows.forEach(row => {
    map.set(Number(row[cId]), {
      STATUS:      str(row[cStatus]),
      TIME_BAND:   str(row[cBand]),
      SKILL_LEVEL: str(row[cSkill]),
      TAGS:        str(row[cTags]),
    });
  });
  return map;
}

/**
 * Builds a Map<recipeId, {avgRating, familyApproved, reviewCount}> from Summary_ReviewSignals.
 * @returns {Map<number, Object>}
 */
function buildReviewSignalMap_() {
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_REVIEWS);
  const cId       = CONFIG.COL.SUMMARY_REVIEWS.RECIPE_ID        - 1;
  const cAvg      = CONFIG.COL.SUMMARY_REVIEWS.AVG_RATING       - 1;
  const cCount    = CONFIG.COL.SUMMARY_REVIEWS.REVIEW_COUNT     - 1;
  const cApproved = CONFIG.COL.SUMMARY_REVIEWS.FAMILY_APPROVED  - 1;

  const map = new Map();
  rows.forEach(row => {
    map.set(Number(row[cId]), {
      avgRating:     Number(row[cAvg]),
      reviewCount:   Number(row[cCount]),
      familyApproved:row[cApproved] === true,
    });
  });
  return map;
}

/**
 * Builds a Map<recipeId, ingredientName[]> for ingredient-based search.
 * Uses Recipe_Ingredients with denormalised INGREDIENT_NAME column.
 * @returns {Map<number, string[]>}
 */
function buildIngredientNameIndex_() {
  const rows    = getAllRows(CONFIG.SHEETS.RECIPE_INGREDIENTS);
  const cRecId  = CONFIG.COL.RECIPE_INGREDIENTS.RECIPE_ID       - 1;
  const cIngNm  = CONFIG.COL.RECIPE_INGREDIENTS.INGREDIENT_NAME - 1;

  const map = new Map();
  rows.forEach(row => {
    const recipeId = Number(row[cRecId]);
    if (!map.has(recipeId)) map.set(recipeId, []);
    map.get(recipeId).push(str(row[cIngNm]).toLowerCase());
  });
  return map;
}

/**
 * Returns true if any ingredient name in the recipe contains the query string.
 * @param {number} recipeId
 * @param {string} query — pre-lowercased
 * @param {Map}    index — from buildIngredientNameIndex_
 * @returns {boolean}
 */
function doesRecipeUseIngredient_(recipeId, query, index) {
  const names = index.get(recipeId) || [];
  return names.some(name => name.includes(query));
}

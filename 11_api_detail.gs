// ============================================================
// 11_api_detail.gs — Project Cantor: Mise en Place
// Recipe detail and shopping list generation endpoints.
//
// All public functions return the standard API envelope:
//   { success: true, data: {...} }
//   { success: false, error: 'message' }
// ============================================================

// ── Recipe Detail ─────────────────────────────────────────────

/**
 * Returns full detail for a single recipe.
 *
 * Includes: recipe record, flat ingredient list with presence flags,
 * method steps, sub-recipe links, scoring (from summary if available),
 * and review signals.
 *
 * @param {number} recipeId
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function getRecipeDetail(recipeId) {
  const FN = 'getRecipeDetail';
  try {
    if (!recipeId) return err_('recipeId is required', FN);

    const recipe = getRecipeById(recipeId);
    if (!recipe) return err_(`Recipe ${recipeId} not found`, FN);

    const presentIds = getPresentIngredientIds();

    // Ingredients with presence flags
    const ingredients = getRecipeIngredients(recipeId, true)  // flatten sub-recipes
      .map(ing => ({
        ingredientId:   Number(ing.INGREDIENT_ID),
        ingredientName: str(ing.INGREDIENT_NAME),
        isPrimary:      ing.IS_PRIMARY === true,
        quantityNote:   str(ing.QUANTITY_NOTE),
        unitNote:       str(ing.UNIT_NOTE),
        isPresent:      presentIds.has(Number(ing.INGREDIENT_ID)),
      }));

    // Method steps sorted by step number
    const methodRows = getAllRows(CONFIG.SHEETS.RECIPE_METHOD);
    const cRecId   = CONFIG.COL.RECIPE_METHOD.RECIPE_ID    - 1;
    const cStep    = CONFIG.COL.RECIPE_METHOD.STEP_NUMBER  - 1;
    const cText    = CONFIG.COL.RECIPE_METHOD.STEP_TEXT    - 1;

    const method = methodRows
      .filter(r => Number(r[cRecId]) === Number(recipeId))
      .sort((a, b) => Number(a[cStep]) - Number(b[cStep]))
      .map(r => ({
        stepNumber: Number(r[cStep]),
        stepText:   str(r[cText]),
      }));

    // Sub-recipe names
    const subRows   = getAllRows(CONFIG.SHEETS.RECIPE_SUBRECIPES);
    const cParent   = CONFIG.COL.RECIPE_SUBRECIPES.PARENT_RECIPE_ID - 1;
    const cChild    = CONFIG.COL.RECIPE_SUBRECIPES.CHILD_RECIPE_ID  - 1;

    const subrecipes = subRows
      .filter(r => Number(r[cParent]) === Number(recipeId))
      .map(r => {
        const childId   = Number(r[cChild]);
        const childData = getRecipeById(childId);
        return { childRecipeId: childId, childRecipeName: childData ? str(childData.NAME) : `[id: ${childId}]` };
      });

    // Score from summary (may be null if summary not yet built)
    const score = getRecipeScoreFromSummary_(recipeId);

    // Reviews with reviewer names
    const reviewRows = getAllRows(CONFIG.SHEETS.RECIPE_REVIEWS);
    const cRevRId  = CONFIG.COL.RECIPE_REVIEWS.RECIPE_ID   - 1;
    const cRevPId  = CONFIG.COL.RECIPE_REVIEWS.PERSON_ID   - 1;
    const cRating  = CONFIG.COL.RECIPE_REVIEWS.RATING      - 1;
    const cComment = CONFIG.COL.RECIPE_REVIEWS.COMMENT     - 1;
    const cRevDate = CONFIG.COL.RECIPE_REVIEWS.REVIEW_DATE - 1;

    const personNames = buildPersonNameMap_();

    const reviews = reviewRows
      .filter(r => Number(r[cRevRId]) === Number(recipeId))
      .sort((a, b) => str(b[cRevDate]).localeCompare(str(a[cRevDate])))
      .map(r => ({
        personId:   Number(r[cRevPId]),
        personName: personNames.get(Number(r[cRevPId])) || `Person ${r[cRevPId]}`,
        rating:     Number(r[cRating]),
        comment:    str(r[cComment]),
        reviewDate: str(r[cRevDate]),
      }));

    // Review signals from summary
    const reviewSignals = getReviewSignalsFromSummary_(recipeId);

    return ok_({
      recipe: {
        id:         Number(recipe.ID),
        name:       str(recipe.NAME),
        timeBand:   str(recipe.TIME_BAND),
        skillLevel: str(recipe.SKILL_LEVEL),
        status:     str(recipe.STATUS),
        lastCooked: str(recipe.LAST_COOKED),
        tags:       str(recipe.TAGS).split(',').map(t => t.trim()).filter(Boolean),
        notes:      str(recipe.NOTES),
      },
      ingredients,
      method,
      subrecipes,
      score,
      reviews,
      reviewSignals,
    });
  } catch (e) {
    return err_(`getRecipeDetail failed: ${e.message}`, FN);
  }
}

// ── Shopping List Generation ──────────────────────────────────

/**
 * Generates and persists a shopping list.
 *
 * Mode behaviours:
 *
 *  'single'
 *    params.recipeId — missing ingredients for one recipe
 *
 *  'multiple'
 *    params.recipeIds[] — aggregate missing across recipes, deduplicated
 *
 *  'use_up'
 *    params.ingredientIds[] — selected near-expiry ingredients on hand
 *    → finds recipes containing those ingredients
 *    → returns missing ingredients needed to complete them
 *
 *  'buy_to_complete'
 *    params.ingredientIds[] — ingredients the user intends to buy
 *    → treats those as virtually present
 *    → finds near-match recipes they contribute to
 *    → returns remaining missing ingredients for those recipes
 *      (excluding the ones being bought)
 *
 * @param {string} mode   — CONFIG.SHOPPING_MODES value
 * @param {Object} params — mode-specific parameters (see above)
 * @param {string} [listName] — optional label for the list
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function generateShoppingList(mode, params, listName) {
  const FN = 'generateShoppingList';
  try {
    if (!Object.values(CONFIG.SHOPPING_MODES).includes(mode)) {
      return err_(`Invalid mode "${mode}"`, FN);
    }

    const p = params || {};
    let items = [];
    let sourceRecipeIds = [];

    switch (mode) {
      case CONFIG.SHOPPING_MODES.SINGLE:
        if (!p.recipeId) return err_('params.recipeId required for single mode', FN);
        items = getMissingForRecipes_([p.recipeId], getPresentIngredientIds());
        sourceRecipeIds = [p.recipeId];
        break;

      case CONFIG.SHOPPING_MODES.MULTIPLE:
        if (!Array.isArray(p.recipeIds) || p.recipeIds.length === 0) {
          return err_('params.recipeIds[] required for multiple mode', FN);
        }
        items = getMissingForRecipes_(p.recipeIds, getPresentIngredientIds());
        sourceRecipeIds = p.recipeIds;
        break;

      case CONFIG.SHOPPING_MODES.USE_UP:
        if (!Array.isArray(p.ingredientIds) || p.ingredientIds.length === 0) {
          return err_('params.ingredientIds[] required for use_up mode', FN);
        }
        ({ items, sourceRecipeIds } = getUseUpShoppingItems_(p.ingredientIds));
        break;

      case CONFIG.SHOPPING_MODES.BUY_TO_COMPLETE:
        if (!Array.isArray(p.ingredientIds) || p.ingredientIds.length === 0) {
          return err_('params.ingredientIds[] required for buy_to_complete mode', FN);
        }
        ({ items, sourceRecipeIds } = getBuyToCompleteItems_(p.ingredientIds));
        break;
    }

    if (items.length === 0) {
      return ok_({ listId: null, items: [], message: 'No missing ingredients — nothing to add to list.' });
    }

    // Persist the list
    const listId = persistShoppingList_(mode, listName, items, sourceRecipeIds);

    return ok_({ listId, items, sourceRecipeIds, totalItems: items.length });

  } catch (e) {
    return err_(`generateShoppingList failed: ${e.message}`, FN);
  }
}

/**
 * Marks a shopping list item as acquired (checked off).
 * @param {number}  listId
 * @param {number}  ingredientId
 * @param {boolean} [acquired=true]
 * @returns {{ success: boolean, error?: string }}
 */
function setItemAcquired(listId, ingredientId, acquired) {
  const FN = 'setItemAcquired';
  try {
    const rows   = getAllRows(CONFIG.SHEETS.SHOPPING_LIST_ITEMS);
    const cList  = CONFIG.COL.SHOPPING_LIST_ITEMS.LIST_ID       - 1;
    const cIngId = CONFIG.COL.SHOPPING_LIST_ITEMS.INGREDIENT_ID - 1;
    const cAcq   = CONFIG.COL.SHOPPING_LIST_ITEMS.ACQUIRED;     // 1-based for setValue

    const idx = rows.findIndex(
      r => Number(r[cList]) === Number(listId) &&
           Number(r[cIngId]) === Number(ingredientId)
    );
    if (idx === -1) return err_(`Item not found in list ${listId}`, FN);

    getSheet(CONFIG.SHEETS.SHOPPING_LIST_ITEMS)
      .getRange(idx + 2, cAcq)
      .setValue(acquired !== false);

    return ok_({ updated: true });
  } catch (e) {
    return err_(`setItemAcquired failed: ${e.message}`, FN);
  }
}

/**
 * Returns the items for a saved shopping list.
 * @param {number} listId
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function getShoppingList(listId) {
  const FN = 'getShoppingList';
  try {
    if (!listId) return err_('listId is required', FN);

    // List header
    const listRows = getAllRows(CONFIG.SHEETS.SHOPPING_LISTS);
    const cLId    = CONFIG.COL.SHOPPING_LISTS.ID           - 1;
    const cLName  = CONFIG.COL.SHOPPING_LISTS.NAME         - 1;
    const cLMode  = CONFIG.COL.SHOPPING_LISTS.MODE         - 1;
    const cLDate  = CONFIG.COL.SHOPPING_LISTS.CREATED_DATE - 1;

    const listRow = listRows.find(r => Number(r[cLId]) === Number(listId));
    if (!listRow) return err_(`Shopping list ${listId} not found`, FN);

    // Items
    const itemRows = getAllRows(CONFIG.SHEETS.SHOPPING_LIST_ITEMS);
    const cIList  = CONFIG.COL.SHOPPING_LIST_ITEMS.LIST_ID         - 1;
    const cIIngId = CONFIG.COL.SHOPPING_LIST_ITEMS.INGREDIENT_ID   - 1;
    const cIIngNm = CONFIG.COL.SHOPPING_LIST_ITEMS.INGREDIENT_NAME - 1;
    const cIQty   = CONFIG.COL.SHOPPING_LIST_ITEMS.QUANTITY_NOTE   - 1;
    const cIAcq   = CONFIG.COL.SHOPPING_LIST_ITEMS.ACQUIRED        - 1;

    const items = itemRows
      .filter(r => Number(r[cIList]) === Number(listId))
      .map(r => ({
        ingredientId:   Number(r[cIIngId]),
        ingredientName: str(r[cIIngNm]),
        quantityNote:   str(r[cIQty]),
        acquired:       r[cIAcq] === true,
      }));

    return ok_({
      listId:      Number(listRow[cLId]),
      name:        str(listRow[cLName]),
      mode:        str(listRow[cLMode]),
      createdDate: str(listRow[cLDate]),
      items,
      totalItems:  items.length,
      acquired:    items.filter(i => i.acquired).length,
    });
  } catch (e) {
    return err_(`getShoppingList failed: ${e.message}`, FN);
  }
}

// ── Shopping List Mode Implementations ───────────────────────

/**
 * Returns deduplicated missing ingredient items across a set of recipe IDs.
 * Uses live stock state (getPresentIngredientIds).
 *
 * @param {number[]} recipeIds
 * @param {Set<number>} presentIds
 * @returns {Object[]} — [{ ingredientId, ingredientName, quantityNotes, recipeNames }]
 */
function getMissingForRecipes_(recipeIds, presentIds) {
  const recipeIngMap = buildRecipeIngredientMap_();
  const subrecipeMap = buildSubrecipeMap_();

  // Map: ingredientId → { ingredientId, ingredientName, quantityNotes[], recipeNames[] }
  const missing = new Map();

  recipeIds.forEach(recipeId => {
    const recipe      = getRecipeById(recipeId);
    const recipeName  = recipe ? str(recipe.NAME) : `Recipe ${recipeId}`;
    const ingredients = getFlatIngredients_(recipeId, recipeIngMap, subrecipeMap);

    ingredients.forEach(ing => {
      const ingId = Number(ing.INGREDIENT_ID);
      if (presentIds.has(ingId)) return;

      if (!missing.has(ingId)) {
        const master = getIngredientById(ingId);
        missing.set(ingId, {
          ingredientId:   ingId,
          ingredientName: master ? str(master.NAME) : `[id: ${ingId}]`,
          quantityNotes:  [],
          recipeNames:    [],
        });
      }
      const entry = missing.get(ingId);
      if (str(ing.QUANTITY_NOTE) && !entry.quantityNotes.includes(str(ing.QUANTITY_NOTE))) {
        entry.quantityNotes.push(str(ing.QUANTITY_NOTE));
      }
      if (!entry.recipeNames.includes(recipeName)) {
        entry.recipeNames.push(recipeName);
      }
    });
  });

  return Array.from(missing.values())
    .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
}

/**
 * Use-Up mode: given near-expiry ingredient IDs the user wants to use,
 * find recipes containing them, then return missing items for those recipes.
 *
 * @param {number[]} selectedIngredientIds
 * @returns {{ items: Object[], sourceRecipeIds: number[] }}
 */
function getUseUpShoppingItems_(selectedIngredientIds) {
  const selectedSet = new Set(selectedIngredientIds.map(Number));

  // Find recipes that use any of the selected ingredients
  // Read from Summary_UseUp for efficiency (already filtered to near-expiry)
  const useUpRows = getAllRows(CONFIG.SHEETS.SUMMARY_USEUP);
  const cIngId  = CONFIG.COL.SUMMARY_USEUP.PERISHABLE_INGREDIENT_ID - 1;
  const cRecId  = CONFIG.COL.SUMMARY_USEUP.RECIPE_ID                - 1;

  const recipeIds = [...new Set(
    useUpRows
      .filter(r => selectedSet.has(Number(r[cIngId])))
      .map(r => Number(r[cRecId]))
  )];

  if (recipeIds.length === 0) {
    return { items: [], sourceRecipeIds: [] };
  }

  const presentIds = getPresentIngredientIds();
  const items = getMissingForRecipes_(recipeIds, presentIds);
  return { items, sourceRecipeIds: recipeIds };
}

/**
 * Buy to Complete mode: given ingredient IDs the user intends to buy,
 * find near-match recipes those ingredients contribute to, then return
 * the remaining missing items for those recipes (excluding intended purchases).
 *
 * @param {number[]} intendedPurchaseIds — ingredient IDs the user plans to buy
 * @returns {{ items: Object[], sourceRecipeIds: number[] }}
 */
function getBuyToCompleteItems_(intendedPurchaseIds) {
  const intendedSet = new Set(intendedPurchaseIds.map(Number));

  // Find near-match recipes where intended purchases appear in MISSING_IDS
  // Read from Summary_BuyUnlock for intended purchases, or scan near-match scores
  const nearMatchRows = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
  const cGroup    = CONFIG.COL.SUMMARY_MATCH.RESULT_GROUP - 1;
  const cRecId    = CONFIG.COL.SUMMARY_MATCH.RECIPE_ID    - 1;
  const cMiss     = CONFIG.COL.SUMMARY_MATCH.MISSING_COUNT - 1;

  // Get near-match recipe IDs
  const nearMatchIds = new Set(
    nearMatchRows
      .filter(r => str(r[cGroup]) === CONFIG.RESULT_GROUPS.NEAR_MATCH)
      .map(r => Number(r[cRecId]))
  );

  if (nearMatchIds.size === 0) {
    return { items: [], sourceRecipeIds: [] };
  }

  // For each near-match recipe, check if any intended purchase is in its missing list
  const recipeIngMap = buildRecipeIngredientMap_();
  const subrecipeMap = buildSubrecipeMap_();
  const presentIds   = getPresentIngredientIds();

  const contributingRecipeIds = [];
  nearMatchIds.forEach(recipeId => {
    const ingredients = getFlatIngredients_(recipeId, recipeIngMap, subrecipeMap);
    const missing     = ingredients
      .map(i => Number(i.INGREDIENT_ID))
      .filter(id => !presentIds.has(id));

    // Does any intended purchase appear in this recipe's missing list?
    const overlaps = missing.some(id => intendedSet.has(id));
    if (overlaps) contributingRecipeIds.push(recipeId);
  });

  if (contributingRecipeIds.length === 0) {
    return { items: [], sourceRecipeIds: [] };
  }

  // Virtually add intended purchases to present set for the missing calculation
  const augmentedPresent = new Set([...presentIds, ...intendedSet]);
  const items = getMissingForRecipes_(contributingRecipeIds, augmentedPresent);

  return { items, sourceRecipeIds: contributingRecipeIds };
}

// ── Shopping List Persistence ─────────────────────────────────

/**
 * Writes a new shopping list header and its items to the data sheets.
 * @param {string}   mode
 * @param {string}   listName
 * @param {Object[]} items
 * @param {number[]} sourceRecipeIds
 * @returns {number} new list ID
 */
function persistShoppingList_(mode, listName, items, sourceRecipeIds) {
  const listId  = nextId(CONFIG.SHEETS.SHOPPING_LISTS);
  const name    = listName || `${mode} list — ${formatDate(today())}`;

  appendRow(CONFIG.SHEETS.SHOPPING_LISTS, 'SHOPPING_LISTS', {
    ID:           listId,
    NAME:         name,
    MODE:         mode,
    CREATED_DATE: formatDate(today()),
    NOTES:        sourceRecipeIds.length > 0
      ? `Recipes: ${sourceRecipeIds.join(', ')}`
      : '',
  });

  items.forEach(item => {
    const itemId = nextId(CONFIG.SHEETS.SHOPPING_LIST_ITEMS);
    appendRow(CONFIG.SHEETS.SHOPPING_LIST_ITEMS, 'SHOPPING_LIST_ITEMS', {
      ID:              itemId,
      LIST_ID:         listId,
      INGREDIENT_ID:   item.ingredientId,
      INGREDIENT_NAME: item.ingredientName,
      QUANTITY_NOTE:   (item.quantityNotes || []).join(' / '),
      ACQUIRED:        false,
    });
  });

  logInfo('persistShoppingList_', `List ${listId} created: ${items.length} items`, { mode, listId });
  return listId;
}

// ── Private Lookup Helpers ────────────────────────────────────

/**
 * Returns the score record for a recipe from Summary_Recipe_Match.
 * Returns null if summary not yet built or recipe not scored.
 * @param {number} recipeId
 * @returns {Object|null}
 */
function getRecipeScoreFromSummary_(recipeId) {
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_MATCH);
  const cId  = CONFIG.COL.SUMMARY_MATCH.RECIPE_ID       - 1;
  const cMatch  = CONFIG.COL.SUMMARY_MATCH.INGREDIENT_MATCH_SCORE - 1;
  const cCook   = CONFIG.COL.SUMMARY_MATCH.COOKABILITY_SCORE      - 1;
  const cUU     = CONFIG.COL.SUMMARY_MATCH.USE_UP_BONUS           - 1;
  const cScore  = CONFIG.COL.SUMMARY_MATCH.COMPOSITE_SCORE        - 1;
  const cGroup  = CONFIG.COL.SUMMARY_MATCH.RESULT_GROUP           - 1;
  const cMiss   = CONFIG.COL.SUMMARY_MATCH.MISSING_COUNT          - 1;
  const cMissP  = CONFIG.COL.SUMMARY_MATCH.MISSING_PRIMARIES      - 1;

  const row = rows.find(r => Number(r[cId]) === Number(recipeId));
  if (!row) return null;
  return {
    matchScore:       Number(row[cMatch]),
    cookabilityScore: Number(row[cCook]),
    useUpBonus:       Number(row[cUU]),
    compositeScore:   Number(row[cScore]),
    resultGroup:      str(row[cGroup]),
    missingCount:     Number(row[cMiss]),
    missingPrimaries: Number(row[cMissP]),
  };
}

/**
 * Returns the review signals for a recipe from Summary_ReviewSignals.
 * Returns null if not found.
 * @param {number} recipeId
 * @returns {Object|null}
 */
function getReviewSignalsFromSummary_(recipeId) {
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_REVIEWS);
  const cId       = CONFIG.COL.SUMMARY_REVIEWS.RECIPE_ID        - 1;
  const cAvg      = CONFIG.COL.SUMMARY_REVIEWS.AVG_RATING       - 1;
  const cCount    = CONFIG.COL.SUMMARY_REVIEWS.REVIEW_COUNT     - 1;
  const cCoverage = CONFIG.COL.SUMMARY_REVIEWS.REVIEWER_COVERAGE - 1;
  const cApproved = CONFIG.COL.SUMMARY_REVIEWS.FAMILY_APPROVED  - 1;

  const row = rows.find(r => Number(r[cId]) === Number(recipeId));
  if (!row) return null;
  return {
    avgRating:        Number(row[cAvg]),
    reviewCount:      Number(row[cCount]),
    reviewerCoverage: str(row[cCoverage]),
    familyApproved:   row[cApproved] === true,
  };
}

/**
 * Builds a Map<personId, name> from Household_People.
 * @returns {Map<number, string>}
 */
function buildPersonNameMap_() {
  const rows  = getAllRows(CONFIG.SHEETS.HOUSEHOLD_PEOPLE);
  const cId   = CONFIG.COL.HOUSEHOLD_PEOPLE.ID   - 1;
  const cName = CONFIG.COL.HOUSEHOLD_PEOPLE.NAME - 1;
  const map   = new Map();
  rows.forEach(r => map.set(Number(r[cId]), str(r[cName])));
  return map;
}

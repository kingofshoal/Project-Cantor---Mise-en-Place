// ============================================================
// 02_recipeEntry.gs — Project Cantor: Mise en Place
// Recipe entry: recipes, ingredients, method steps, sub-recipes.
//
// Typical flow for adding a new recipe:
//   1. const id = addRecipe('Pasta al Limone', 'Quick', 'Easy', 'pasta,citrus', '');
//   2. addRecipeIngredient(id, 'spaghetti',      true,  '200g',  'g');
//      addRecipeIngredient(id, 'lemon',           true,  '1',     '');
//      addRecipeIngredient(id, 'parmesan',        true,  'handful','g');
//      addRecipeIngredient(id, 'black pepper',    false, 'to taste','');
//   3. addRecipeMethod(id, ['Boil pasta.', 'Zest lemon...', 'Combine.']);
//   4. (optional) addSubrecipe(id, childRecipeId);
// ============================================================

// ── Recipe ────────────────────────────────────────────────────

/**
 * Adds a new recipe record to the Recipes sheet.
 * Status defaults to 'Testing'. Last cooked date is left blank.
 *
 * @param {string} name         — required
 * @param {string} timeBand     — 'Quick' | 'Standard' | 'Project'
 * @param {string} skillLevel   — 'Easy' | 'Moderate' | 'Challenging'
 * @param {string} [tags]       — comma-separated, optional
 * @param {string} [notes]      — optional
 * @returns {number} new recipe ID
 */
function addRecipe(name, timeBand, skillLevel, tags, notes) {
  const FN = 'addRecipe';

  if (!str(name)) throw new Error(`${FN}: name is required`);

  if (!CONFIG.TIME_BANDS.includes(timeBand)) {
    throw new Error(`${FN}: invalid timeBand "${timeBand}". Must be one of: ${CONFIG.TIME_BANDS.join(', ')}`);
  }
  if (!CONFIG.SKILL_LEVELS.includes(skillLevel)) {
    throw new Error(`${FN}: invalid skillLevel "${skillLevel}". Must be one of: ${CONFIG.SKILL_LEVELS.join(', ')}`);
  }

  const id = nextId(CONFIG.SHEETS.RECIPES);

  appendRow(CONFIG.SHEETS.RECIPES, 'RECIPES', {
    ID:          id,
    NAME:        str(name),
    TIME_BAND:   timeBand,
    SKILL_LEVEL: skillLevel,
    STATUS:      CONFIG.RECIPE_STATUS.TESTING,
    LAST_COOKED: '',
    TAGS:        str(tags),
    NOTES:       str(notes),
  });

  logInfo(FN, `Recipe added: "${name}"`, { id, timeBand, skillLevel });
  return id;
}

/**
 * Updates the STATUS of a recipe (Testing → Approved or vice versa).
 * @param {number} recipeId
 * @param {string} status — CONFIG.RECIPE_STATUS value
 */
function updateRecipeStatus(recipeId, status) {
  const FN = 'updateRecipeStatus';
  if (!Object.values(CONFIG.RECIPE_STATUS).includes(status)) {
    throw new Error(`${FN}: invalid status "${status}"`);
  }
  const rowNum = findRecipeRowNumber_(recipeId);
  if (rowNum === -1) throw new Error(`${FN}: recipe ${recipeId} not found`);

  getSheet(CONFIG.SHEETS.RECIPES)
    .getRange(rowNum, CONFIG.COL.RECIPES.STATUS)
    .setValue(status);

  logInfo(FN, `Recipe ${recipeId} status → ${status}`);
}

/**
 * Updates the LAST_COOKED date for a recipe.
 * Called automatically by logMeal() in a later module.
 * @param {number} recipeId
 * @param {Date|string} date — defaults to today if omitted
 */
function updateLastCooked(recipeId, date) {
  const FN = 'updateLastCooked';
  const rowNum = findRecipeRowNumber_(recipeId);
  if (rowNum === -1) throw new Error(`${FN}: recipe ${recipeId} not found`);

  const cookDate = date ? new Date(date) : today();
  getSheet(CONFIG.SHEETS.RECIPES)
    .getRange(rowNum, CONFIG.COL.RECIPES.LAST_COOKED)
    .setValue(formatDate(cookDate));

  logInfo(FN, `Recipe ${recipeId} last cooked → ${formatDate(cookDate)}`);
}

/**
 * Returns a recipe record object by ID. Returns null if not found.
 * @param {number} recipeId
 * @returns {Object|null}
 */
function getRecipeById(recipeId) {
  const rows = getAllRows(CONFIG.SHEETS.RECIPES);
  const colId = CONFIG.COL.RECIPES.ID - 1;
  const row = rows.find(r => Number(r[colId]) === Number(recipeId));
  if (!row) return null;
  return rowToObject_(row, CONFIG.COL.RECIPES);
}

// ── Ingredients Master ────────────────────────────────────────

/**
 * Adds a new ingredient to Ingredients_Master.
 * Also registers the canonical name as an alias so it resolves to itself.
 *
 * @param {string} name
 * @param {string} [category]    — e.g. 'Dairy', 'Produce', 'Pantry'
 * @param {string} [taxonomyTag] — e.g. 'citrus', 'brassica'
 * @returns {number} new ingredient ID
 */
function addIngredientToMaster(name, category, taxonomyTag) {
  const FN = 'addIngredientToMaster';
  if (!str(name)) throw new Error(`${FN}: name is required`);

  // Guard against duplicates (case-insensitive exact match on name)
  const existing = findMasterIngredientByName_(str(name));
  if (existing !== null) {
    logWarn(FN, `Ingredient already exists: "${name}"`, { existingId: existing });
    return existing;
  }

  const id = nextId(CONFIG.SHEETS.INGREDIENTS_MASTER);

  appendRow(CONFIG.SHEETS.INGREDIENTS_MASTER, 'INGREDIENTS_MASTER', {
    ID:           id,
    NAME:         str(name),
    CATEGORY:     str(category),
    TAXONOMY_TAG: str(taxonomyTag),
    CREATED_DATE: formatDate(today()),
  });

  // Register the canonical name as an alias pointing to itself
  addAlias_(str(name), id);

  logInfo(FN, `Ingredient added to master: "${name}"`, { id, category, taxonomyTag });
  return id;
}

/**
 * Adds an alias entry mapping an alias string to a master ingredient ID.
 * Public-facing variant — use when manually registering known aliases.
 * @param {string} aliasText
 * @param {number} masterIngredientId
 */
function addAlias(aliasText, masterIngredientId) {
  const FN = 'addAlias';
  if (!str(aliasText)) throw new Error(`${FN}: aliasText is required`);
  if (!masterIngredientId) throw new Error(`${FN}: masterIngredientId is required`);

  // Guard against duplicate aliases
  const existing = resolveAlias(aliasText);
  if (existing !== null) {
    logWarn(FN, `Alias already exists: "${aliasText}" → ${existing}`);
    return;
  }

  addAlias_(aliasText, masterIngredientId);
  logInfo(FN, `Alias added: "${aliasText}" → ingredient ${masterIngredientId}`);
}

// ── Recipe Ingredients ────────────────────────────────────────

/**
 * Adds an ingredient line to a recipe, resolving the raw text
 * through the alias system before writing.
 *
 * Resolution order:
 *   1. Ingredient_Aliases (case-insensitive)
 *   2. Ingredients_Master.NAME (case-insensitive exact match)
 *   3. Auto-create in master as 'Uncategorised' + register alias
 *      (WARN logged — review in master later)
 *
 * @param {number}  recipeId
 * @param {string}  rawIngredientText — as typed, e.g. 'cherry tomatoes'
 * @param {boolean} isPrimary         — TRUE if this is a key/primary ingredient
 * @param {string}  [quantityNote]    — e.g. '200g', 'a handful'
 * @param {string}  [unitNote]        — e.g. 'g', 'ml', 'bunch'
 * @returns {number} the resolved master ingredient ID
 */
function addRecipeIngredient(recipeId, rawIngredientText, isPrimary, quantityNote, unitNote) {
  const FN = 'addRecipeIngredient';
  if (!recipeId) throw new Error(`${FN}: recipeId is required`);
  if (!str(rawIngredientText)) throw new Error(`${FN}: rawIngredientText is required`);

  const masterId = resolveOrCreateIngredient_(rawIngredientText);
  const ingredient = getIngredientById(masterId);
  const ingredientName = ingredient ? str(ingredient.NAME) : str(rawIngredientText);

  const id = nextId(CONFIG.SHEETS.RECIPE_INGREDIENTS);

  appendRow(CONFIG.SHEETS.RECIPE_INGREDIENTS, 'RECIPE_INGREDIENTS', {
    ID:              id,
    RECIPE_ID:       recipeId,
    INGREDIENT_ID:   masterId,
    INGREDIENT_NAME: ingredientName,
    IS_PRIMARY:      isPrimary === true,
    QUANTITY_NOTE:   str(quantityNote),
    UNIT_NOTE:       str(unitNote),
  });

  logInfo(FN, `Ingredient added to recipe ${recipeId}: "${ingredientName}"`,
    { masterId, isPrimary, rawIngredientText });

  return masterId;
}

/**
 * Returns all ingredient rows for a recipe as objects.
 * Pass flattenSubrecipes=true to include sub-recipe ingredients
 * (one level deep — V1 limit).
 *
 * @param {number}  recipeId
 * @param {boolean} [flattenSubrecipes=false]
 * @returns {Object[]}
 */
function getRecipeIngredients(recipeId, flattenSubrecipes) {
  const allRows = getAllRowsAsObjects(
    CONFIG.SHEETS.RECIPE_INGREDIENTS, 'RECIPE_INGREDIENTS'
  );

  const direct = allRows.filter(r => Number(r.RECIPE_ID) === Number(recipeId));

  if (!flattenSubrecipes) return direct;

  // Flatten one level of sub-recipes
  const subRows = getAllRows(CONFIG.SHEETS.RECIPE_SUBRECIPES);
  const colParent = CONFIG.COL.RECIPE_SUBRECIPES.PARENT_RECIPE_ID - 1;
  const colChild  = CONFIG.COL.RECIPE_SUBRECIPES.CHILD_RECIPE_ID  - 1;

  const childIds = subRows
    .filter(r => Number(r[colParent]) === Number(recipeId))
    .map(r => Number(r[colChild]));

  const childIngredients = childIds.flatMap(childId =>
    allRows.filter(r => Number(r.RECIPE_ID) === Number(childId))
  );

  // Deduplicate by INGREDIENT_ID — direct ingredients take precedence
  const seen = new Set(direct.map(r => Number(r.INGREDIENT_ID)));
  const uniqueChild = childIngredients.filter(r => {
    const id = Number(r.INGREDIENT_ID);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return [...direct, ...uniqueChild];
}

// ── Recipe Method ─────────────────────────────────────────────

/**
 * Adds method steps for a recipe.
 * Accepts an array of step strings; step numbers are assigned sequentially.
 * Appends to any existing steps (allows incremental entry).
 *
 * @param {number}   recipeId
 * @param {string[]} steps — ordered array of step text strings
 */
function addRecipeMethod(recipeId, steps) {
  const FN = 'addRecipeMethod';
  if (!recipeId) throw new Error(`${FN}: recipeId is required`);
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(`${FN}: steps must be a non-empty array`);
  }

  // Find the current highest step number for this recipe
  const existing = getAllRows(CONFIG.SHEETS.RECIPE_METHOD);
  const colRecipe = CONFIG.COL.RECIPE_METHOD.RECIPE_ID    - 1;
  const colStep   = CONFIG.COL.RECIPE_METHOD.STEP_NUMBER  - 1;

  const existingStepNums = existing
    .filter(r => Number(r[colRecipe]) === Number(recipeId))
    .map(r => Number(r[colStep]));

  let stepNumber = existingStepNums.length > 0
    ? Math.max(...existingStepNums)
    : 0;

  steps.forEach(stepText => {
    if (!str(stepText)) return; // skip blank steps
    stepNumber++;
    const id = nextId(CONFIG.SHEETS.RECIPE_METHOD);
    appendRow(CONFIG.SHEETS.RECIPE_METHOD, 'RECIPE_METHOD', {
      ID:          id,
      RECIPE_ID:   recipeId,
      STEP_NUMBER: stepNumber,
      STEP_TEXT:   str(stepText),
    });
  });

  logInfo(FN, `${steps.length} step(s) added to recipe ${recipeId}`);
}

// ── Sub-Recipes ───────────────────────────────────────────────

/**
 * Links a child recipe as a sub-recipe of a parent.
 * Guards against self-reference and duplicate links.
 *
 * @param {number} parentRecipeId
 * @param {number} childRecipeId
 */
function addSubrecipe(parentRecipeId, childRecipeId) {
  const FN = 'addSubrecipe';
  if (!parentRecipeId || !childRecipeId) {
    throw new Error(`${FN}: both parentRecipeId and childRecipeId are required`);
  }
  if (Number(parentRecipeId) === Number(childRecipeId)) {
    throw new Error(`${FN}: a recipe cannot be a sub-recipe of itself`);
  }

  // Guard against duplicate
  const existing = getAllRows(CONFIG.SHEETS.RECIPE_SUBRECIPES);
  const colParent = CONFIG.COL.RECIPE_SUBRECIPES.PARENT_RECIPE_ID - 1;
  const colChild  = CONFIG.COL.RECIPE_SUBRECIPES.CHILD_RECIPE_ID  - 1;
  const duplicate = existing.some(r =>
    Number(r[colParent]) === Number(parentRecipeId) &&
    Number(r[colChild])  === Number(childRecipeId)
  );
  if (duplicate) {
    logWarn(FN, `Subrecipe link already exists`, { parentRecipeId, childRecipeId });
    return;
  }

  const id = nextId(CONFIG.SHEETS.RECIPE_SUBRECIPES);
  appendRow(CONFIG.SHEETS.RECIPE_SUBRECIPES, 'RECIPE_SUBRECIPES', {
    ID:               id,
    PARENT_RECIPE_ID: parentRecipeId,
    CHILD_RECIPE_ID:  childRecipeId,
  });

  logInfo(FN, `Subrecipe linked: recipe ${childRecipeId} → parent ${parentRecipeId}`);
}

// ── Meal History ──────────────────────────────────────────────

/**
 * Logs a meal to Meal_History and updates the recipe's LAST_COOKED date.
 * @param {number}      recipeId
 * @param {Date|string} [cookedDate] — defaults to today
 * @param {string}      [notes]
 * @returns {number} new meal history log ID
 */
function logMeal(recipeId, cookedDate, notes) {
  const FN = 'logMeal';
  if (!recipeId) throw new Error(`${FN}: recipeId is required`);

  const recipe = getRecipeById(recipeId);
  if (!recipe) throw new Error(`${FN}: recipe ${recipeId} not found`);

  const date = cookedDate ? new Date(cookedDate) : today();
  const id = nextId(CONFIG.SHEETS.MEAL_HISTORY);

  appendRow(CONFIG.SHEETS.MEAL_HISTORY, 'MEAL_HISTORY', {
    ID:          id,
    RECIPE_ID:   recipeId,
    RECIPE_NAME: str(recipe.NAME),
    COOKED_DATE: formatDate(date),
    NOTES:       str(notes),
  });

  updateLastCooked(recipeId, date);
  logInfo(FN, `Meal logged: "${recipe.NAME}" on ${formatDate(date)}`, { id, recipeId });
  return id;
}

// ── Reviews ───────────────────────────────────────────────────

/**
 * Adds a review for a recipe by a household member.
 * @param {number} recipeId
 * @param {number} personId   — must be an active Household_People ID
 * @param {number} rating     — 1–5
 * @param {string} [comment]
 * @returns {number} new review ID
 */
function addReview(recipeId, personId, rating, comment) {
  const FN = 'addReview';
  if (!recipeId) throw new Error(`${FN}: recipeId is required`);
  if (!personId) throw new Error(`${FN}: personId is required`);

  const ratingNum = Number(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new Error(`${FN}: rating must be 1–5`);
  }

  const id = nextId(CONFIG.SHEETS.RECIPE_REVIEWS);

  appendRow(CONFIG.SHEETS.RECIPE_REVIEWS, 'RECIPE_REVIEWS', {
    ID:          id,
    RECIPE_ID:   recipeId,
    PERSON_ID:   personId,
    RATING:      ratingNum,
    COMMENT:     str(comment),
    REVIEW_DATE: formatDate(today()),
  });

  logInfo(FN, `Review added: recipe ${recipeId} by person ${personId} — ${ratingNum}★`,
    { id, recipeId, personId, rating: ratingNum });
  return id;
}

// ── Private Helpers ───────────────────────────────────────────

/**
 * Resolves a raw ingredient text to a master ingredient ID.
 * Creates the ingredient automatically if no match is found.
 *
 * Resolution order:
 *   1. Ingredient_Aliases (case-insensitive)
 *   2. Ingredients_Master.NAME (case-insensitive exact)
 *   3. Auto-create as 'Uncategorised' + log WARN to review later
 *
 * @param {string} rawText
 * @returns {number} master ingredient ID
 */
function resolveOrCreateIngredient_(rawText) {
  const FN = 'resolveOrCreateIngredient_';
  const normalised = str(rawText).toLowerCase();

  // 1. Check aliases
  const aliasMatch = resolveAlias(rawText);
  if (aliasMatch !== null) return aliasMatch;

  // 2. Check master by name
  const nameMatch = findMasterIngredientByName_(rawText);
  if (nameMatch !== null) {
    // Register the alias so future lookups hit route 1
    addAlias_(rawText, nameMatch);
    return nameMatch;
  }

  // 3. Auto-create
  logWarn(FN, `No match for "${rawText}" — auto-creating as Uncategorised. Review in Ingredients_Master.`);
  const id = nextId(CONFIG.SHEETS.INGREDIENTS_MASTER);

  appendRow(CONFIG.SHEETS.INGREDIENTS_MASTER, 'INGREDIENTS_MASTER', {
    ID:           id,
    NAME:         str(rawText),
    CATEGORY:     'Uncategorised',
    TAXONOMY_TAG: '',
    CREATED_DATE: formatDate(today()),
  });

  addAlias_(str(rawText), id);
  return id;
}

/**
 * Case-insensitive exact search of Ingredients_Master by name.
 * Returns the master ingredient ID or null.
 * @param {string} name
 * @returns {number|null}
 */
function findMasterIngredientByName_(name) {
  const normalised = str(name).toLowerCase();
  const rows = getAllRows(CONFIG.SHEETS.INGREDIENTS_MASTER);
  const colId   = CONFIG.COL.INGREDIENTS_MASTER.ID   - 1;
  const colName = CONFIG.COL.INGREDIENTS_MASTER.NAME - 1;

  const row = rows.find(r => str(r[colName]).toLowerCase() === normalised);
  return row ? Number(row[colId]) : null;
}

/**
 * Internal alias writer — no duplicate check, no logging.
 * Called by resolveOrCreateIngredient_ and addIngredientToMaster.
 * @param {string} aliasText
 * @param {number} masterIngredientId
 */
function addAlias_(aliasText, masterIngredientId) {
  const id = nextId(CONFIG.SHEETS.INGREDIENT_ALIASES);
  appendRow(CONFIG.SHEETS.INGREDIENT_ALIASES, 'INGREDIENT_ALIASES', {
    ID:                   id,
    ALIAS_TEXT:           str(aliasText),
    MASTER_INGREDIENT_ID: masterIngredientId,
  });
}

/**
 * Returns the 1-based sheet row number for a recipe ID, or -1 if not found.
 * @param {number} recipeId
 * @returns {number}
 */
function findRecipeRowNumber_(recipeId) {
  const rows = getAllRows(CONFIG.SHEETS.RECIPES);
  const colId = CONFIG.COL.RECIPES.ID - 1;
  const idx = rows.findIndex(r => Number(r[colId]) === Number(recipeId));
  return idx === -1 ? -1 : idx + 2; // +2: 1-based index + skip header row
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Logs a summary of the recipe entry data. Run from the GAS editor.
 */
function diagRecipeEntry() {
  Logger.log('=== diagRecipeEntry ===');

  const recipes     = getAllRows(CONFIG.SHEETS.RECIPES);
  const ingredients = getAllRows(CONFIG.SHEETS.RECIPE_INGREDIENTS);
  const method      = getAllRows(CONFIG.SHEETS.RECIPE_METHOD);
  const master      = getAllRows(CONFIG.SHEETS.INGREDIENTS_MASTER);
  const aliases     = getAllRows(CONFIG.SHEETS.INGREDIENT_ALIASES);
  const subrecipes  = getAllRows(CONFIG.SHEETS.RECIPE_SUBRECIPES);

  Logger.log(`Recipes            : ${recipes.length}`);
  Logger.log(`Recipe Ingredients : ${ingredients.length}`);
  Logger.log(`Method Steps       : ${method.length}`);
  Logger.log(`Ingredients Master : ${master.length}`);
  Logger.log(`Aliases            : ${aliases.length}`);
  Logger.log(`Subrecipe links    : ${subrecipes.length}`);

  // Flag uncategorised ingredients
  const colCat = CONFIG.COL.INGREDIENTS_MASTER.CATEGORY - 1;
  const uncategorised = master.filter(r => str(r[colCat]).toLowerCase() === 'uncategorised');
  if (uncategorised.length > 0) {
    Logger.log(`\nWARN: ${uncategorised.length} uncategorised ingredient(s) need review:`);
    const colName = CONFIG.COL.INGREDIENTS_MASTER.NAME - 1;
    const colId   = CONFIG.COL.INGREDIENTS_MASTER.ID   - 1;
    uncategorised.forEach(r => Logger.log(`  ID ${r[colId]}: ${r[colName]}`));
  }

  // Status breakdown
  const colStatus = CONFIG.COL.RECIPES.STATUS - 1;
  const testing  = recipes.filter(r => str(r[colStatus]) === CONFIG.RECIPE_STATUS.TESTING).length;
  const approved = recipes.filter(r => str(r[colStatus]) === CONFIG.RECIPE_STATUS.APPROVED).length;
  Logger.log(`\nRecipe status — Testing: ${testing}  Approved: ${approved}`);
}

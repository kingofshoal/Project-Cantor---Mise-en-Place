// ============================================================
// 02_stockEntry.gs — Project Cantor: Mise en Place
// Pantry and perishable stock management.
//
// Pantry: presence-based. Each ingredient appears at most once.
//   - Staple = assumed present unless marked out-of-stock.
//   - Non-staple = present or absent.
//
// Perishables: presence-based with date and state.
//   - Same ingredient can have multiple entries (bought in batches).
//   - States: fresh → use_soon → critical → used
//   - autoUpdatePerishableStates() should be called before any
//     summary rebuild to keep states current.
// ============================================================

// ── Pantry ────────────────────────────────────────────────────

/**
 * Adds an ingredient to Pantry_Stock, or updates it if already present.
 * Upsert behaviour: if the ingredient exists, isStaple is updated
 * and out_of_stock is set to FALSE (i.e. re-stocking clears OOS).
 *
 * @param {number}  ingredientId
 * @param {string}  ingredientName — denormalised label
 * @param {boolean} [isStaple=false]
 */
function addOrUpdatePantryItem(ingredientId, ingredientName, isStaple) {
  const FN = 'addOrUpdatePantryItem';
  if (!ingredientId) throw new Error(`${FN}: ingredientId is required`);

  const existingRow = findPantryRowNumber_(ingredientId);

  if (existingRow !== -1) {
    // Update existing row
    const sheet = getSheet(CONFIG.SHEETS.PANTRY_STOCK);
    sheet.getRange(existingRow, CONFIG.COL.PANTRY_STOCK.IS_STAPLE)
         .setValue(isStaple === true);
    sheet.getRange(existingRow, CONFIG.COL.PANTRY_STOCK.OUT_OF_STOCK)
         .setValue(false);
    sheet.getRange(existingRow, CONFIG.COL.PANTRY_STOCK.LAST_UPDATED)
         .setValue(formatDate(today()));
    logInfo(FN, `Pantry item updated: "${ingredientName}" (id ${ingredientId})`,
      { isStaple: isStaple === true });
    return;
  }

  // New row
  const id = nextId(CONFIG.SHEETS.PANTRY_STOCK);
  appendRow(CONFIG.SHEETS.PANTRY_STOCK, 'PANTRY_STOCK', {
    ID:              id,
    INGREDIENT_ID:   ingredientId,
    INGREDIENT_NAME: str(ingredientName),
    IS_STAPLE:       isStaple === true,
    OUT_OF_STOCK:    false,
    LAST_UPDATED:    formatDate(today()),
  });

  logInfo(FN, `Pantry item added: "${ingredientName}" (id ${ingredientId})`,
    { isStaple: isStaple === true });
}

/**
 * Marks a pantry item as out of stock.
 * For staples, this overrides the assumed-present logic in the matching engine.
 * @param {number}  ingredientId
 * @param {boolean} [outOfStock=true]
 */
function setPantryOutOfStock(ingredientId, outOfStock) {
  const FN = 'setPantryOutOfStock';
  const rowNum = findPantryRowNumber_(ingredientId);
  if (rowNum === -1) throw new Error(`${FN}: ingredient ${ingredientId} not in pantry`);

  const oos = outOfStock !== false; // default true
  const sheet = getSheet(CONFIG.SHEETS.PANTRY_STOCK);
  sheet.getRange(rowNum, CONFIG.COL.PANTRY_STOCK.OUT_OF_STOCK).setValue(oos);
  sheet.getRange(rowNum, CONFIG.COL.PANTRY_STOCK.LAST_UPDATED).setValue(formatDate(today()));

  logInfo(FN, `Ingredient ${ingredientId} out_of_stock → ${oos}`);
}

/**
 * Removes an ingredient from Pantry_Stock entirely.
 * Use when an ingredient is no longer stocked at all.
 * @param {number} ingredientId
 */
function removePantryItem(ingredientId) {
  const FN = 'removePantryItem';
  const rowNum = findPantryRowNumber_(ingredientId);
  if (rowNum === -1) {
    logWarn(FN, `Ingredient ${ingredientId} not found in pantry — nothing removed`);
    return;
  }
  getSheet(CONFIG.SHEETS.PANTRY_STOCK).deleteRow(rowNum);
  logInfo(FN, `Pantry item removed: ingredient ${ingredientId}`);
}

// ── Perishables ───────────────────────────────────────────────

/**
 * Adds a new perishable entry to Perishable_Stock.
 * The same ingredient can be added multiple times (e.g. two packs of chicken).
 *
 * State is auto-assigned from useByDate if not explicitly provided:
 *   - daysUntil(useByDate) <= CRITICAL_DAYS → 'critical'
 *   - daysUntil(useByDate) <= USE_SOON_DAYS → 'use_soon'
 *   - otherwise → 'fresh'
 *
 * @param {number}      ingredientId
 * @param {string}      ingredientName
 * @param {Date|string} useByDate    — the use-by or best-before date
 * @param {string}      [state]      — explicit state override; auto-derived if omitted
 * @returns {number} new perishable entry ID
 */
function addPerishable(ingredientId, ingredientName, useByDate, state) {
  const FN = 'addPerishable';
  if (!ingredientId)  throw new Error(`${FN}: ingredientId is required`);
  if (!useByDate)     throw new Error(`${FN}: useByDate is required`);

  const resolvedState = state
    ? str(state)
    : derivePerishableState_(useByDate);

  const id = nextId(CONFIG.SHEETS.PERISHABLE_STOCK);

  appendRow(CONFIG.SHEETS.PERISHABLE_STOCK, 'PERISHABLE_STOCK', {
    ID:              id,
    INGREDIENT_ID:   ingredientId,
    INGREDIENT_NAME: str(ingredientName),
    DATE_ADDED:      formatDate(today()),
    USE_BY_DATE:     formatDate(new Date(useByDate)),
    STATE:           resolvedState,
    LAST_UPDATED:    formatDate(today()),
  });

  logInfo(FN, `Perishable added: "${ingredientName}" use-by ${formatDate(new Date(useByDate))}`,
    { id, ingredientId, state: resolvedState });
  return id;
}

/**
 * Updates the state of a specific perishable entry by its row ID.
 * @param {number} perishableId — the ID column value (not the sheet row number)
 * @param {string} newState     — CONFIG.PERISHABLE_STATES value
 */
function updatePerishableState(perishableId, newState) {
  const FN = 'updatePerishableState';
  if (!Object.values(CONFIG.PERISHABLE_STATES).includes(newState)) {
    throw new Error(`${FN}: invalid state "${newState}"`);
  }

  const rowNum = findPerishableRowNumber_(perishableId);
  if (rowNum === -1) throw new Error(`${FN}: perishable ID ${perishableId} not found`);

  const sheet = getSheet(CONFIG.SHEETS.PERISHABLE_STOCK);
  sheet.getRange(rowNum, CONFIG.COL.PERISHABLE_STOCK.STATE)
       .setValue(newState);
  sheet.getRange(rowNum, CONFIG.COL.PERISHABLE_STOCK.LAST_UPDATED)
       .setValue(formatDate(today()));

  logInfo(FN, `Perishable ${perishableId} state → ${newState}`);
}

/**
 * Marks a perishable entry as 'used'.
 * Convenience wrapper for the most common state transition.
 * @param {number} perishableId
 */
function markPerishableUsed(perishableId) {
  updatePerishableState(perishableId, CONFIG.PERISHABLE_STATES.USED);
}

/**
 * Scans all non-used perishable entries and updates their STATE
 * based on how many days remain until their USE_BY_DATE.
 *
 * Rules (applied in priority order):
 *   daysUntil <= CRITICAL_DAYS → 'critical'
 *   daysUntil <= USE_SOON_DAYS → 'use_soon' (only if currently 'fresh')
 *   past use-by date           → 'critical' (overdue)
 *
 * Only updates rows where the state actually changes.
 * Logs a summary of all transitions made.
 *
 * Run this before any summary rebuild to ensure state accuracy.
 */
function autoUpdatePerishableStates() {
  const FN = 'autoUpdatePerishableStates';
  const sheet = getSheet(CONFIG.SHEETS.PERISHABLE_STOCK);
  const rows = getAllRows(CONFIG.SHEETS.PERISHABLE_STOCK);

  const colId       = CONFIG.COL.PERISHABLE_STOCK.ID           - 1;
  const colUseBy    = CONFIG.COL.PERISHABLE_STOCK.USE_BY_DATE   - 1;
  const colState    = CONFIG.COL.PERISHABLE_STOCK.STATE         - 1;
  const colUpdated  = CONFIG.COL.PERISHABLE_STOCK.LAST_UPDATED  - 1;

  const stateColIndex   = CONFIG.COL.PERISHABLE_STOCK.STATE;
  const updatedColIndex = CONFIG.COL.PERISHABLE_STOCK.LAST_UPDATED;

  let updated = 0;
  const todayStr = formatDate(today());

  rows.forEach((row, idx) => {
    const currentState = str(row[colState]);
    if (currentState === CONFIG.PERISHABLE_STATES.USED) return; // skip consumed

    const useByDate = row[colUseBy];
    if (!useByDate) return; // skip if no date

    const daysLeft = daysUntil(useByDate);
    let newState = currentState;

    if (daysLeft <= CONFIG.USE_UP.CRITICAL_DAYS) {
      newState = CONFIG.PERISHABLE_STATES.CRITICAL;
    } else if (daysLeft <= CONFIG.USE_UP.USE_SOON_DAYS &&
               currentState === CONFIG.PERISHABLE_STATES.FRESH) {
      newState = CONFIG.PERISHABLE_STATES.USE_SOON;
    }
    // Past use-by (negative days) already caught by <= CRITICAL_DAYS check

    if (newState !== currentState) {
      const sheetRow = idx + 2; // +2: 1-based + skip header
      sheet.getRange(sheetRow, stateColIndex).setValue(newState);
      sheet.getRange(sheetRow, updatedColIndex).setValue(todayStr);
      logInfo(FN, `Perishable ID ${row[colId]} state: ${currentState} → ${newState}`,
        { daysLeft, useByDate: formatDate(new Date(useByDate)) });
      updated++;
    }
  });

  Logger.log(`${FN}: ${updated} perishable state(s) updated`);
}

// ── Household People ──────────────────────────────────────────

/**
 * Adds a household member.
 * @param {string}  name
 * @param {boolean} [isActive=true]
 * @returns {number} new person ID
 */
function addHouseholdMember(name, isActive) {
  const FN = 'addHouseholdMember';
  if (!str(name)) throw new Error(`${FN}: name is required`);

  const id = nextId(CONFIG.SHEETS.HOUSEHOLD_PEOPLE);
  appendRow(CONFIG.SHEETS.HOUSEHOLD_PEOPLE, 'HOUSEHOLD_PEOPLE', {
    ID:        id,
    NAME:      str(name),
    IS_ACTIVE: isActive !== false, // default true
  });

  logInfo(FN, `Household member added: "${name}"`, { id });
  return id;
}

/**
 * Sets a household member's active status.
 * @param {number}  personId
 * @param {boolean} isActive
 */
function setHouseholdMemberActive(personId, isActive) {
  const FN = 'setHouseholdMemberActive';
  const rowNum = findRowByIdInSheet_(CONFIG.SHEETS.HOUSEHOLD_PEOPLE,
                                     CONFIG.COL.HOUSEHOLD_PEOPLE.ID,
                                     personId);
  if (rowNum === -1) throw new Error(`${FN}: person ${personId} not found`);

  getSheet(CONFIG.SHEETS.HOUSEHOLD_PEOPLE)
    .getRange(rowNum, CONFIG.COL.HOUSEHOLD_PEOPLE.IS_ACTIVE)
    .setValue(isActive === true);

  logInfo(FN, `Person ${personId} is_active → ${isActive}`);
}

// ── Private Helpers ───────────────────────────────────────────

/**
 * Returns the 1-based sheet row number for an ingredient ID in Pantry_Stock,
 * or -1 if not found.
 * @param {number} ingredientId
 * @returns {number}
 */
function findPantryRowNumber_(ingredientId) {
  return findRowByIdInSheet_(
    CONFIG.SHEETS.PANTRY_STOCK,
    CONFIG.COL.PANTRY_STOCK.INGREDIENT_ID,
    ingredientId
  );
}

/**
 * Returns the 1-based sheet row number for a perishable entry ID
 * in Perishable_Stock, or -1 if not found.
 * @param {number} perishableId
 * @returns {number}
 */
function findPerishableRowNumber_(perishableId) {
  return findRowByIdInSheet_(
    CONFIG.SHEETS.PERISHABLE_STOCK,
    CONFIG.COL.PERISHABLE_STOCK.ID,
    perishableId
  );
}

/**
 * Generic row finder: returns the 1-based sheet row number for
 * a record where the value in colIndex matches the target value.
 * Returns -1 if not found.
 * @param {string} sheetName
 * @param {number} colIndex  — 1-based
 * @param {number} targetVal
 * @returns {number}
 */
function findRowByIdInSheet_(sheetName, colIndex, targetVal) {
  const rows = getAllRows(sheetName);
  const idx = rows.findIndex(r => Number(r[colIndex - 1]) === Number(targetVal));
  return idx === -1 ? -1 : idx + 2;
}

/**
 * Derives an initial perishable state from a use-by date.
 * @param {Date|string} useByDate
 * @returns {string} CONFIG.PERISHABLE_STATES value
 */
function derivePerishableState_(useByDate) {
  const days = daysUntil(useByDate);
  if (days <= CONFIG.USE_UP.CRITICAL_DAYS) return CONFIG.PERISHABLE_STATES.CRITICAL;
  if (days <= CONFIG.USE_UP.USE_SOON_DAYS) return CONFIG.PERISHABLE_STATES.USE_SOON;
  return CONFIG.PERISHABLE_STATES.FRESH;
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Logs a stock summary to the GAS editor. Run before a summary rebuild
 * to confirm stock state is as expected.
 */
function diagStock() {
  Logger.log('=== diagStock ===');

  const pantryRows    = getAllRows(CONFIG.SHEETS.PANTRY_STOCK);
  const perishRows    = getAllRows(CONFIG.SHEETS.PERISHABLE_STOCK);
  const householdRows = getAllRows(CONFIG.SHEETS.HOUSEHOLD_PEOPLE);

  // Pantry summary
  const colStaple = CONFIG.COL.PANTRY_STOCK.IS_STAPLE    - 1;
  const colOos    = CONFIG.COL.PANTRY_STOCK.OUT_OF_STOCK - 1;
  const staples   = pantryRows.filter(r => r[colStaple] === true);
  const oos       = pantryRows.filter(r => r[colOos] === true);

  Logger.log(`Pantry items    : ${pantryRows.length} total`);
  Logger.log(`  Staples       : ${staples.length}`);
  Logger.log(`  Out of stock  : ${oos.length}`);

  // Perishable summary by state
  const colState = CONFIG.COL.PERISHABLE_STOCK.STATE - 1;
  const stateCounts = Object.values(CONFIG.PERISHABLE_STATES).reduce((acc, s) => {
    acc[s] = perishRows.filter(r => str(r[colState]) === s).length;
    return acc;
  }, {});

  Logger.log(`Perishables     : ${perishRows.length} total`);
  Object.entries(stateCounts).forEach(([state, count]) => {
    Logger.log(`  ${state.padEnd(10)}: ${count}`);
  });

  // Near-expiry detail
  const nearExpiry = getNearExpiryIngredientIds();
  Logger.log(`Near-expiry ingredient IDs (${nearExpiry.size}): ${[...nearExpiry].join(', ') || 'none'}`);

  // Household
  const colActive = CONFIG.COL.HOUSEHOLD_PEOPLE.IS_ACTIVE - 1;
  const active = householdRows.filter(r => r[colActive] === true).length;
  Logger.log(`Household       : ${householdRows.length} total  (${active} active)`);

  // Present ingredient count
  const present = getPresentIngredientIds();
  Logger.log(`Present ingredient IDs: ${present.size}`);
}

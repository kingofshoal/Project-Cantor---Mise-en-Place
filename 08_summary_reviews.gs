// ============================================================
// 08_summary_reviews.gs — Project Cantor: Mise en Place
// Rebuilds the Summary_ReviewSignals cache sheet.
//
// Summary_ReviewSignals answers:
//   - What is the average rating for each recipe?
//   - Which recipes are Family Approved?
//   - How many household members have reviewed each recipe?
//
// Family Approved definition (from spec):
//   Every active household member has at least one review
//   with rating >= REVIEWS.FAMILY_APPROVED_MIN_RATING (3).
//
// Output: one row per recipe that has at least one review,
// sorted by Family Approved (TRUE first), then avg rating desc.
// ============================================================

/**
 * Rebuilds Summary_ReviewSignals from current review and household data.
 *
 * Steps:
 *   1. Load all reviews, grouped by recipe
 *   2. Load active household member IDs
 *   3. For each reviewed recipe: compute avg rating, coverage, Family Approved
 *   4. Batch-write to summary sheet
 *
 * @returns {{ rowsWritten: number, elapsedMs: number }}
 */
function rebuildSummaryReviews() {
  const FN = 'rebuildSummaryReviews';
  logInfo(FN, 'Rebuild started');
  const t0 = Date.now();

  const reviews       = getAllRows(CONFIG.SHEETS.RECIPE_REVIEWS);
  const activePersons = getActivePersonIds(); // Set<personId> from 01_util.gs

  if (reviews.length === 0) {
    clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_REVIEWS, 'SUMMARY_REVIEWS', []);
    logInfo(FN, 'No reviews — summary cleared');
    Logger.log('rebuildSummaryReviews: no reviews found, summary cleared');
    return { rowsWritten: 0, elapsedMs: Date.now() - t0 };
  }

  // ── Group reviews by recipe ───────────────────────────────
  const colRecipeId  = CONFIG.COL.RECIPE_REVIEWS.RECIPE_ID   - 1;
  const colPersonId  = CONFIG.COL.RECIPE_REVIEWS.PERSON_ID   - 1;
  const colRating    = CONFIG.COL.RECIPE_REVIEWS.RATING       - 1;
  const colDate      = CONFIG.COL.RECIPE_REVIEWS.REVIEW_DATE  - 1;

  // reviewsByRecipe: Map<recipeId, {personId, rating, date}[]>
  const reviewsByRecipe = new Map();
  reviews.forEach(row => {
    const recipeId = Number(row[colRecipeId]);
    if (!reviewsByRecipe.has(recipeId)) reviewsByRecipe.set(recipeId, []);
    reviewsByRecipe.get(recipeId).push({
      personId: Number(row[colPersonId]),
      rating:   Number(row[colRating]),
      date:     str(row[colDate]),
    });
  });

  // ── Load recipe names for denormalisation ─────────────────
  const recipeRows = getAllRows(CONFIG.SHEETS.RECIPES);
  const cRecId   = CONFIG.COL.RECIPES.ID   - 1;
  const cRecName = CONFIG.COL.RECIPES.NAME - 1;
  const recipeNameCache = new Map();
  recipeRows.forEach(row => {
    recipeNameCache.set(Number(row[cRecId]), str(row[cRecName]));
  });

  // ── Compute signals per recipe ────────────────────────────
  const outputRows = [];
  const minRating  = CONFIG.REVIEWS.FAMILY_APPROVED_MIN_RATING;
  const totalActive = activePersons.size;

  reviewsByRecipe.forEach((recipeReviews, recipeId) => {
    // Average rating across all reviews for this recipe
    const avgRating = round(
      recipeReviews.reduce((sum, r) => sum + r.rating, 0) / recipeReviews.length,
      2
    );

    // Most recent review date
    const lastReviewDate = recipeReviews
      .map(r => r.date)
      .filter(Boolean)
      .sort()
      .pop() || '';

    // Family Approved:
    //   Every active household member has at least one review with rating >= min
    //   We check per active person: does any of their reviews meet the threshold?
    const approvedPersonIds = new Set();
    recipeReviews.forEach(r => {
      if (activePersons.has(r.personId) && r.rating >= minRating) {
        approvedPersonIds.add(r.personId);
      }
    });

    // Reviewer coverage: how many distinct active members reviewed (any rating)
    const reviewingPersonIds = new Set(
      recipeReviews
        .filter(r => activePersons.has(r.personId))
        .map(r => r.personId)
    );

    const familyApproved = totalActive > 0 && approvedPersonIds.size === totalActive;
    const coverage       = `${reviewingPersonIds.size}/${totalActive}`;

    outputRows.push(objectToSummaryRow_({
      RECIPE_ID:         recipeId,
      RECIPE_NAME:       recipeNameCache.get(recipeId) || `[id: ${recipeId}]`,
      AVG_RATING:        avgRating,
      REVIEW_COUNT:      recipeReviews.length,
      REVIEWER_COVERAGE: coverage,
      FAMILY_APPROVED:   familyApproved,
      LAST_REVIEW_DATE:  lastReviewDate,
    }, 'SUMMARY_REVIEWS'));
  });

  // Sort: Family Approved TRUE first, then avg rating desc
  const cApproved = CONFIG.COL.SUMMARY_REVIEWS.FAMILY_APPROVED - 1;
  const cAvgRating = CONFIG.COL.SUMMARY_REVIEWS.AVG_RATING     - 1;

  outputRows.sort((a, b) => {
    // TRUE sorts before FALSE (TRUE = 1, FALSE = 0 in numeric context)
    const approvedDiff = (b[cApproved] === true ? 1 : 0) - (a[cApproved] === true ? 1 : 0);
    if (approvedDiff !== 0) return approvedDiff;
    return Number(b[cAvgRating]) - Number(a[cAvgRating]);
  });

  clearAndWriteSummary_(CONFIG.SHEETS.SUMMARY_REVIEWS, 'SUMMARY_REVIEWS', outputRows);

  const elapsed = Date.now() - t0;
  logInfo(FN, `Rebuild complete: ${outputRows.length} rows in ${elapsed}ms`);
  Logger.log(`rebuildSummaryReviews: ${outputRows.length} recipes written (${elapsed}ms)`);
  return { rowsWritten: outputRows.length, elapsedMs: elapsed };
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Logs a summary of the current Summary_ReviewSignals contents.
 */
function diagSummaryReviews() {
  Logger.log('=== diagSummaryReviews ===');
  const rows = getAllRows(CONFIG.SHEETS.SUMMARY_REVIEWS);
  if (rows.length === 0) {
    Logger.log('Summary_ReviewSignals is empty — run rebuildSummaryReviews() first');
    return;
  }

  const cName     = CONFIG.COL.SUMMARY_REVIEWS.RECIPE_NAME      - 1;
  const cAvg      = CONFIG.COL.SUMMARY_REVIEWS.AVG_RATING        - 1;
  const cCount    = CONFIG.COL.SUMMARY_REVIEWS.REVIEW_COUNT      - 1;
  const cCoverage = CONFIG.COL.SUMMARY_REVIEWS.REVIEWER_COVERAGE - 1;
  const cApproved = CONFIG.COL.SUMMARY_REVIEWS.FAMILY_APPROVED   - 1;

  const approved    = rows.filter(r => r[cApproved] === true).length;
  const notApproved = rows.length - approved;

  Logger.log(`Total reviewed recipes : ${rows.length}`);
  Logger.log(`Family Approved        : ${approved}`);
  Logger.log(`Not yet approved       : ${notApproved}`);
  Logger.log('');
  Logger.log('Top 10 by rating:');

  rows.slice(0, 10).forEach((r, i) => {
    const fa = r[cApproved] === true ? '★ ' : '  ';
    Logger.log(
      `  ${fa}${String(i + 1).padStart(2)}. [${Number(r[cAvg]).toFixed(1)}★ ` +
      `${r[cCount]} reviews  ${r[cCoverage]} members] ${r[cName]}`
    );
  });
}

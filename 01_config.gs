// ============================================================
// 01_config.gs — Project Cantor: Mise en Place
// Constants, column maps, score weights, thresholds.
// This is the single source of truth for sheet structure.
// Never hardcode sheet names or column numbers elsewhere.
// ============================================================

const CONFIG = {

  // ── Sheet Names ────────────────────────────────────────────
  SHEETS: {
    RECIPES:              'Recipes',
    RECIPE_INGREDIENTS:   'Recipe_Ingredients',
    RECIPE_METHOD:        'Recipe_Method',
    RECIPE_SUBRECIPES:    'Recipe_Subrecipes',
    INGREDIENTS_MASTER:   'Ingredients_Master',
    INGREDIENT_ALIASES:   'Ingredient_Aliases',
    PANTRY_STOCK:         'Pantry_Stock',
    PERISHABLE_STOCK:     'Perishable_Stock',
    HOUSEHOLD_PEOPLE:     'Household_People',
    MEAL_HISTORY:         'Meal_History',
    RECIPE_REVIEWS:       'Recipe_Reviews',
    SHOPPING_LISTS:       'Shopping_Lists',
    SHOPPING_LIST_ITEMS:  'Shopping_List_Items',
    SUMMARY_MATCH:        'Summary_Recipe_Match',
    SUMMARY_USEUP:        'Summary_UseUp',
    SUMMARY_BUY_UNLOCK:   'Summary_BuyUnlock',
    SUMMARY_REVIEWS:      'Summary_ReviewSignals',
  },

  // ── Column Maps (1-indexed) ────────────────────────────────
  // Authoritative column positions for every sheet.
  // Read/write exclusively via these constants.

  COL: {

    RECIPES: {
      ID:           1,  // recipe_id
      NAME:         2,
      TIME_BAND:    3,  // Quick | Standard | Project
      SKILL_LEVEL:  4,  // Easy | Moderate | Challenging
      STATUS:       5,  // Testing | Approved
      LAST_COOKED:  6,  // date — drives recency decay
      TAGS:         7,  // comma-separated
      NOTES:        8,
    },

    RECIPE_INGREDIENTS: {
      ID:              1,
      RECIPE_ID:       2,
      INGREDIENT_ID:   3,
      INGREDIENT_NAME: 4,  // denormalised for readability
      IS_PRIMARY:      5,  // TRUE | FALSE
      QUANTITY_NOTE:   6,  // informational only, no quantity maths in V1
      UNIT_NOTE:       7,
    },

    RECIPE_METHOD: {
      ID:          1,
      RECIPE_ID:   2,
      STEP_NUMBER: 3,
      STEP_TEXT:   4,
    },

    RECIPE_SUBRECIPES: {
      ID:               1,
      PARENT_RECIPE_ID: 2,
      CHILD_RECIPE_ID:  3,
    },

    INGREDIENTS_MASTER: {
      ID:           1,
      NAME:         2,
      CATEGORY:     3,
      TAXONOMY_TAG: 4,
      CREATED_DATE: 5,
    },

    INGREDIENT_ALIASES: {
      ID:                   1,
      ALIAS_TEXT:           2,  // the raw text variant
      MASTER_INGREDIENT_ID: 3,  // resolves to Ingredients_Master.ID
    },

    PANTRY_STOCK: {
      ID:              1,
      INGREDIENT_ID:   2,
      INGREDIENT_NAME: 3,
      IS_STAPLE:       4,  // TRUE = assumed present unless OUT_OF_STOCK
      OUT_OF_STOCK:    5,  // TRUE overrides staple logic; treats as missing
      LAST_UPDATED:    6,
    },

    PERISHABLE_STOCK: {
      ID:              1,
      INGREDIENT_ID:   2,
      INGREDIENT_NAME: 3,
      DATE_ADDED:      4,
      USE_BY_DATE:     5,
      STATE:           6,  // fresh | use_soon | critical | used
      LAST_UPDATED:    7,
    },

    HOUSEHOLD_PEOPLE: {
      ID:        1,
      NAME:      2,
      IS_ACTIVE: 3,  // only active members count toward Family Approved
    },

    MEAL_HISTORY: {
      ID:          1,
      RECIPE_ID:   2,
      RECIPE_NAME: 3,  // denormalised
      COOKED_DATE: 4,
      NOTES:       5,
    },

    RECIPE_REVIEWS: {
      ID:          1,
      RECIPE_ID:   2,
      PERSON_ID:   3,
      RATING:      4,  // 1–5
      COMMENT:     5,
      REVIEW_DATE: 6,
    },

    SHOPPING_LISTS: {
      ID:           1,
      NAME:         2,
      MODE:         3,  // single | multiple | use_up | buy_to_complete
      CREATED_DATE: 4,
      NOTES:        5,
    },

    SHOPPING_LIST_ITEMS: {
      ID:              1,
      LIST_ID:         2,
      INGREDIENT_ID:   3,
      INGREDIENT_NAME: 4,
      QUANTITY_NOTE:   5,
      ACQUIRED:        6,  // TRUE | FALSE
    },

    // ── Summary Sheets ───────────────────────────────────────

    SUMMARY_MATCH: {
      RECIPE_ID:              1,
      RECIPE_NAME:            2,
      INGREDIENT_MATCH_SCORE: 3,  // 0.0–1.0
      COOKABILITY_SCORE:      4,  // 0.0–1.0
      USE_UP_BONUS:           5,  // 0.0 or 1.0
      COMPOSITE_SCORE:        6,  // weighted total
      RESULT_GROUP:           7,
      MISSING_COUNT:          8,  // absolute number of missing ingredients
      MISSING_PRIMARIES:      9,  // absolute number of missing primary ingredients
      LAST_REBUILT:           10,
    },

    SUMMARY_USEUP: {
      PERISHABLE_INGREDIENT_ID: 1,
      INGREDIENT_NAME:          2,
      USE_BY_DATE:              3,
      STATE:                    4,
      RECIPE_ID:                5,
      RECIPE_NAME:              6,
      COMPOSITE_SCORE:          7,
      RESULT_GROUP:             8,
    },

    SUMMARY_BUY_UNLOCK: {
      INGREDIENT_ID:   1,
      INGREDIENT_NAME: 2,
      UNLOCK_COUNT:    3,  // near-match recipes promoted to Can Cook Now
      RECIPE_IDS:      4,  // pipe-delimited list of unlockable recipe IDs
    },

    SUMMARY_REVIEWS: {
      RECIPE_ID:         1,
      RECIPE_NAME:       2,
      AVG_RATING:        3,
      REVIEW_COUNT:      4,
      REVIEWER_COVERAGE: 5,  // 'n/m' e.g. '2/3' active members reviewed
      FAMILY_APPROVED:   6,  // TRUE | FALSE
      LAST_REVIEW_DATE:  7,
    },
  },

  // ── Composite Score Weights ────────────────────────────────
  WEIGHTS: {
    INGREDIENT_MATCH: 0.60,
    COOKABILITY:      0.25,
    USE_UP_BONUS:     0.15,

    // Ingredient match sub-weights
    MATCH_PRIMARY_WEIGHT: 0.70,  // share from primary ingredients
    MATCH_ALL_WEIGHT:     0.30,  // share from all ingredients

    // Cookability sub-weights (each 50% of the 25%)
    COOKABILITY_DELTA:   0.50,  // ingredient delta component
    COOKABILITY_RECENCY: 0.50,  // recency decay component
  },

  // ── Recency Decay ──────────────────────────────────────────
  // Linear decay: 0.0 (cooked today) → 1.0 (cooked DECAY_DAYS+ ago)
  RECENCY: {
    DECAY_DAYS: 30,
  },

  // ── Use-Up Thresholds ──────────────────────────────────────
  USE_UP: {
    USE_SOON_DAYS: 5,   // flag as use_soon if use_by within N days
    CRITICAL_DAYS: 2,   // flag as critical if use_by within N days
    BONUS_VALUE:   1.0, // full bonus applied when any near-expiry item used
  },

  // ── Reviews ────────────────────────────────────────────────
  REVIEWS: {
    FAMILY_APPROVED_MIN_RATING: 3,  // minimum per reviewer to count toward approval
  },

  // ── Enum Values ────────────────────────────────────────────
  PERISHABLE_STATES: {
    FRESH:    'fresh',
    USE_SOON: 'use_soon',
    CRITICAL: 'critical',
    USED:     'used',
  },

  RECIPE_STATUS: {
    TESTING:  'Testing',
    APPROVED: 'Approved',
  },

  SHOPPING_MODES: {
    SINGLE:          'single',
    MULTIPLE:        'multiple',
    USE_UP:          'use_up',
    BUY_TO_COMPLETE: 'buy_to_complete',
  },

  RESULT_GROUPS: {
    CAN_COOK_NOW:      'Can Cook Now',
    NEAR_MATCH:        'Near Match',
    MISSING_A_FEW:     'Missing A Few Items',
    SHOPPING_REQUIRED: 'Shopping Required',
  },

  TIME_BANDS:   ['Quick', 'Standard', 'Project'],
  SKILL_LEVELS: ['Easy', 'Moderate', 'Challenging'],
};

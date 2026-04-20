// ============================================================
// 01_logging.gs — Project Cantor: Mise en Place
// Structured logging to a dedicated _Log sheet.
//
// Usage:
//   logInfo('matchingEngine', 'Rebuild started');
//   logWarn('recipeEntry',    'Alias not found', { raw: 'cherry tomatoes' });
//   logError('summaryMatch',  'Sheet missing',   { sheet: 'Summary_Recipe_Match' });
//
// All entries also echo to Logger.log for GAS editor visibility.
// ============================================================

const LOG_SHEET_NAME = '_Log';

const LOG_LEVELS = {
  INFO:  'INFO',
  WARN:  'WARN',
  ERROR: 'ERROR',
};

// ── Core Logger ───────────────────────────────────────────────

/**
 * Writes a structured log entry to the _Log sheet and Logger.log.
 * Creates the log sheet automatically if it does not exist.
 *
 * @param {string} level    — INFO | WARN | ERROR
 * @param {string} source   — calling function or module name
 * @param {string} message
 * @param {any}    [detail] — optional structured detail (JSON-stringified)
 */
function log(level, source, message, detail) {
  const timestamp = new Date();
  const detailStr = detail !== undefined ? JSON.stringify(detail) : '';

  // Always echo to Logger.log for immediate GAS editor feedback
  const editorLine = `[${level}] ${source}: ${message}${detailStr ? ' | ' + detailStr : ''}`;
  Logger.log(editorLine);

  // Write to log sheet — best-effort, does not throw
  try {
    const sheet = getOrCreateLogSheet_();
    sheet.appendRow([timestamp, level, source, message, detailStr]);
  } catch (e) {
    Logger.log(`[WARN] logging: could not write to log sheet: ${e.message}`);
  }
}

// ── Convenience Wrappers ──────────────────────────────────────

/** @param {string} source @param {string} message @param {any} [detail] */
function logInfo(source, message, detail)  { log(LOG_LEVELS.INFO,  source, message, detail); }

/** @param {string} source @param {string} message @param {any} [detail] */
function logWarn(source, message, detail)  { log(LOG_LEVELS.WARN,  source, message, detail); }

/** @param {string} source @param {string} message @param {any} [detail] */
function logError(source, message, detail) { log(LOG_LEVELS.ERROR, source, message, detail); }

// ── Log Sheet Lifecycle ───────────────────────────────────────

/**
 * Returns the _Log sheet, creating it with headers if it doesn't exist.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateLogSheet_() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    const headers = ['Timestamp', 'Level', 'Source', 'Message', 'Detail'];
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#333333');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);

    // Widen timestamp and message columns
    sheet.setColumnWidth(1, 160); // Timestamp
    sheet.setColumnWidth(4, 300); // Message
    sheet.setColumnWidth(5, 400); // Detail
  }

  return sheet;
}

// ── Log Management ────────────────────────────────────────────

/**
 * Trims the log sheet to the most recent N data rows.
 * Oldest rows are removed first. Default: keep 500.
 * Run from the GAS editor periodically to prevent unbounded growth.
 * @param {number} [keepRows=500]
 */
function trimLog(keepRows) {
  const keep = (typeof keepRows === 'number' && keepRows > 0) ? keepRows : 500;
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);

  if (!sheet) {
    Logger.log('trimLog: _Log sheet not found — nothing to trim');
    return;
  }

  const lastRow  = sheet.getLastRow();
  const dataRows = lastRow - 1; // exclude header

  if (dataRows <= keep) {
    Logger.log(`trimLog: ${dataRows} rows present, limit is ${keep} — nothing to trim`);
    return;
  }

  const toDelete = dataRows - keep;
  sheet.deleteRows(2, toDelete); // row 2 is the oldest data row
  Logger.log(`trimLog: removed ${toDelete} row(s), kept ${keep}`);
}

/**
 * Clears all log entries from the _Log sheet (header preserved).
 * Run from the GAS editor for a clean slate during development.
 */
function clearLog() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);

  if (!sheet) {
    Logger.log('clearLog: _Log sheet not found');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('clearLog: log already empty');
    return;
  }

  sheet.deleteRows(2, lastRow - 1);
  Logger.log(`clearLog: removed ${lastRow - 1} row(s)`);
}

// ── Diagnostics ───────────────────────────────────────────────

/**
 * Prints the N most recent log entries to the GAS editor Logger.
 * @param {number} [n=20]
 */
function diagLog(n) {
  const limit = (typeof n === 'number' && n > 0) ? n : 20;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);

  if (!sheet) {
    Logger.log('diagLog: _Log sheet not found');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('diagLog: log is empty');
    return;
  }

  const startRow = Math.max(2, lastRow - limit + 1);
  const count    = lastRow - startRow + 1;
  const rows     = sheet.getRange(startRow, 1, count, 5).getValues();

  Logger.log(`=== diagLog (${rows.length} most recent entries) ===`);
  rows.forEach(row => {
    const ts     = row[0] ? new Date(row[0]).toISOString() : '—';
    const level  = row[1] || '—';
    const source = row[2] || '—';
    const msg    = row[3] || '';
    const detail = row[4] ? ` | ${row[4]}` : '';
    Logger.log(`${ts}  [${level}]  ${source}: ${msg}${detail}`);
  });
}

/**
 * Counts log entries by level and prints a summary.
 * Useful for getting an overview of system health.
 */
function diagLogSummary() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);

  if (!sheet) {
    Logger.log('diagLogSummary: _Log sheet not found');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('diagLogSummary: log is empty');
    return;
  }

  const levels = sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat();
  const counts = levels.reduce((acc, level) => {
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {});

  Logger.log('=== diagLogSummary ===');
  Logger.log(`Total entries : ${levels.length}`);
  Logger.log(`INFO          : ${counts['INFO']  || 0}`);
  Logger.log(`WARN          : ${counts['WARN']  || 0}`);
  Logger.log(`ERROR         : ${counts['ERROR'] || 0}`);
}

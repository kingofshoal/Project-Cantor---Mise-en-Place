// ============================================================
// 20_webapp.gs — Project Cantor: Mise en Place
// Web app entry point. Deploy as a Google Apps Script web app.
//
// Deploy: Extensions → Apps Script → Deploy → New deployment
//         Type: Web app
//         Execute as: Me
//         Who has access: Anyone with Google account (or Anyone)
// ============================================================

/**
 * Web app entry point. Serves the SPA shell.
 * @param {Object} e — request event object
 * @returns {HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('20_index')
    .evaluate()
    .setTitle('Project Cantor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Includes another HTML file's content into a template.
 * Used by 20_index.html as: <?!= include('21_styles') ?>
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

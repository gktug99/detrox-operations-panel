const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const DEFAULT_WORKBOOK_NAME = "CİHAZ ÜRETİM YETKİNLİK MATRİSİ_20261901.xlsx";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || DATA_DIR);

function resolveWorkbookPath() {
  if (process.env.WORKBOOK_PATH) {
    return path.resolve(process.env.WORKBOOK_PATH);
  }

  const configuredWorkbookName = process.env.WORKBOOK_FILENAME || DEFAULT_WORKBOOK_NAME;
  const preferredPath = path.join(STORAGE_DIR, configuredWorkbookName);
  const legacyPath = path.join(ROOT_DIR, DEFAULT_WORKBOOK_NAME);

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return preferredPath;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  STORAGE_DIR,
  WORKBOOK_PATH: resolveWorkbookPath(),
  PRODUCTS_FILE: path.resolve(process.env.PRODUCTS_FILE || path.join(DATA_DIR, "products.json")),
  PERSONNEL_GROWTH_FILE: path.resolve(
    process.env.PERSONNEL_GROWTH_FILE || path.join(STORAGE_DIR, "personnel-growth-history.json")
  ),
  SNAPSHOT_SCHEDULER_ENABLED: process.env.SNAPSHOT_SCHEDULER_ENABLED !== "false"
};

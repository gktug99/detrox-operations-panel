const path = require("path");

const ROOT_DIR = __dirname;
const DEFAULT_DATA_WORKBOOK_NAME = "detrox-data-workbook.xlsx";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || DATA_DIR);

const DATA_WORKBOOK_PATH = path.resolve(
  process.env.DATA_WORKBOOK_PATH || path.join(STORAGE_DIR, DEFAULT_DATA_WORKBOOK_NAME)
);

function resolveWorkbookPath() {
  if (process.env.WORKBOOK_PATH) {
    return path.resolve(process.env.WORKBOOK_PATH);
  }

  return DATA_WORKBOOK_PATH;
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  STORAGE_DIR,
  WORKBOOK_PATH: resolveWorkbookPath(),
  DATA_WORKBOOK_PATH,
  DB_PATH: path.resolve(process.env.DB_PATH || path.join(STORAGE_DIR, "detrox.sqlite")),
  ADMIN_PASSWORD: String(process.env.ADMIN_PASSWORD || "detrox2024"),
  PRODUCTS_FILE: path.resolve(process.env.PRODUCTS_FILE || path.join(DATA_DIR, "products.json")),
  PERSONNEL_GROWTH_FILE: path.resolve(
    process.env.PERSONNEL_GROWTH_FILE || path.join(STORAGE_DIR, "personnel-growth-history.json")
  ),
  SNAPSHOT_SCHEDULER_ENABLED: process.env.SNAPSHOT_SCHEDULER_ENABLED !== "false"
};

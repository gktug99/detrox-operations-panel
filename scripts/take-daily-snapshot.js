const { WORKBOOK_PATH, PERSONNEL_GROWTH_FILE } = require("../config");
const { loadWorkbookAnalytics } = require("../services/workbookAnalytics");
const { getLocalDateKey, saveDailySnapshot } = require("../services/personnelGrowth");

async function main() {
  const analytics = loadWorkbookAnalytics();
  const snapshotDate = getLocalDateKey();
  const result = await saveDailySnapshot(PERSONNEL_GROWTH_FILE, analytics, snapshotDate);

  if (result.created) {
    console.log(`Gunluk snapshot olusturuldu: ${snapshotDate}`);
  } else {
    console.log(`Bugun icin snapshot zaten mevcut: ${snapshotDate}`);
  }

  console.log(`Excel dosyasi: ${WORKBOOK_PATH}`);
  console.log(`Gecmis dosyasi: ${PERSONNEL_GROWTH_FILE}`);
}

main().catch((error) => {
  console.error("Gunluk snapshot komutu basarisiz:", error.message);
  process.exit(1);
});

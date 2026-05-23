const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildDutySheetRows(personnelRows) {
  const rows = [];

  rows.push([
    "",
    "DETROX CİHAZ MONTAJ PERSONEL GÖREV DAĞILIM LİSTESİ\r\nDEVICE ASSEMBLY STAFF DUTY ASSIGNMENT LIST",
    "",
    "",
    "Doküman No.\r\nDocument Nu.",
    ""
  ]);
  rows.push(["", "", "", "", "Yayın Tarihi\r\nPublication Date", ""]);
  rows.push(["", "", "", "", "Revizyon No.\r\nRevision Nu.", ""]);
  rows.push(["", "", "", "", "Revizyon Tarihi\r\nRevision Date", ""]);
  rows.push([
    "ADI SOYADI\r\nNAME & SURNAME",
    "ANA GÖREV\r\nMAIN DUTY",
    "YAN GÖREV\r\nSECOND DUTY",
    "KADRO ÜNVANI\r\nJOB TITLE",
    "OLMADIĞINDA YERİNE BAKACAK KİŞİ\r\nALTERNATE",
    "YETKİLİSİ\r\nSUPERVISOR"
  ]);

  personnelRows.forEach((person) => {
    rows.push([
      person.name,
      person.main_duty,
      person.secondary_duty,
      "",
      "",
      person.supervisor
    ]);
  });

  return rows;
}

function buildOperationsSheetRows(operations, personnel, scoreMapByOperationId) {
  const header = ["SIRA NO", "CİHAZ", "STOK KODU", "STOK ADI", "ZORLUK DERECESİ"];
  const subHeader = ["", "", "", "", ""];

  personnel.forEach((person) => {
    header.push(`${person.name} (H)`, person.name);
    subHeader.push("HEDEF", "GERÇEKLEŞEN");
  });

  const rows = [header, subHeader];

  operations.forEach((operation) => {
    const row = [
      operation.sequence,
      operation.device,
      operation.stock_code,
      operation.operation_name,
      operation.difficulty
    ];

    const scoreMap = scoreMapByOperationId.get(operation.id) || new Map();

    personnel.forEach((person) => {
      const score = scoreMap.get(person.id) || null;
      row.push(score?.target_score ?? "", score?.actual_score ?? "");
    });

    rows.push(row);
  });

  return rows;
}

function exportDataWorkbook({ db, workbookPath }) {
  if (!db) {
    throw new Error("db zorunludur");
  }

  if (!workbookPath) {
    throw new Error("workbookPath zorunludur");
  }

  ensureDirForFile(workbookPath);

  const personnel = db
    .prepare("SELECT id, name, main_duty, secondary_duty, supervisor FROM personnel ORDER BY name")
    .all();

  const operations = db
    .prepare("SELECT id, sequence, device, stock_code, operation_name, difficulty FROM operations ORDER BY sequence")
    .all();

  const scores = db
    .prepare(
      "SELECT operation_id, personnel_id, target_score, actual_score FROM operation_scores"
    )
    .all();

  const scoreMapByOperationId = new Map();
  scores.forEach((row) => {
    if (!scoreMapByOperationId.has(row.operation_id)) {
      scoreMapByOperationId.set(row.operation_id, new Map());
    }
    scoreMapByOperationId.get(row.operation_id).set(row.personnel_id, row);
  });

  const wb = xlsx.utils.book_new();
  const dutySheet = xlsx.utils.aoa_to_sheet(buildDutySheetRows(personnel));
  const operationsSheet = xlsx.utils.aoa_to_sheet(
    buildOperationsSheetRows(operations, personnel, scoreMapByOperationId)
  );

  xlsx.utils.book_append_sheet(wb, dutySheet, "Personel Görev Dağılım");
  xlsx.utils.book_append_sheet(wb, operationsSheet, "Tüm Operasyonlar");

  xlsx.writeFile(wb, workbookPath, { compression: true });
  return workbookPath;
}

module.exports = {
  exportDataWorkbook
};


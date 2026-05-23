const fs = require("fs");
const xlsx = require("xlsx");
const { normalizePersonName } = require("./workbookAnalytics");

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");

    if (normalized === "" || normalized === "-") {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseDutySheet(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const dutyRows = rows.slice(5).filter((row) => String(row[0] || "").trim() !== "");

  return dutyRows.map((row) => ({
    name: normalizePersonName(row[0]),
    mainDuty: String(row[1] || "").trim(),
    secondaryDuty: String(row[2] || "").trim(),
    supervisor: normalizePersonName(row[5])
  }));
}

function parseOperationsSheet(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = rows[0] || [];
  const dataRows = rows.slice(2).filter((row) => toNumber(row[0]) !== null);

  const baseColumns = {
    sequence: 0,
    device: 1,
    stockCode: 2,
    operationName: 3,
    difficulty: 4
  };

  const personColumns = [];
  for (let index = 5; index < headerRow.length; index += 2) {
    const targetHeader = normalizePersonName(headerRow[index]);
    const actualHeader = normalizePersonName(headerRow[index + 1]);
    const resolvedName = actualHeader || targetHeader;

    if (!resolvedName) {
      continue;
    }

    personColumns.push({
      name: resolvedName,
      targetIndex: index,
      actualIndex: index + 1
    });
  }

  const operationRows = dataRows.map((row) => ({
    sequence: toNumber(row[baseColumns.sequence]),
    device: String(row[baseColumns.device] || "").trim(),
    stockCode: String(row[baseColumns.stockCode] || "").trim(),
    operationName: String(row[baseColumns.operationName] || "").trim(),
    difficulty: toNumber(row[baseColumns.difficulty]),
    scores: personColumns
      .map((person) => {
        const targetScore = toNumber(row[person.targetIndex]);
        const actualScore = toNumber(row[person.actualIndex]);
        if (targetScore === null && actualScore === null) {
          return null;
        }

        return {
          name: person.name,
          targetScore,
          actualScore
        };
      })
      .filter(Boolean)
  }));

  return { operationRows };
}

function importWorkbookToDb({ db, workbookPath }) {
  if (!db) {
    throw new Error("db zorunludur");
  }

  if (!workbookPath) {
    throw new Error("workbookPath zorunludur");
  }

  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Excel dosyasi bulunamadi: ${workbookPath}`);
  }

  const workbook = xlsx.readFile(workbookPath);
  const dutySheet = workbook.Sheets["Personel Görev Dağılım"];
  const operationsSheet = workbook.Sheets["Tüm Operasyonlar"];

  if (!dutySheet || !operationsSheet) {
    throw new Error("Excel sayfalari eksik: Personel Görev Dağılım / Tüm Operasyonlar");
  }

  const dutyRows = parseDutySheet(dutySheet);
  const { operationRows } = parseOperationsSheet(operationsSheet);

  const insertPersonnel = db.prepare(
    `
      INSERT INTO personnel (name, main_duty, secondary_duty, supervisor, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        main_duty = excluded.main_duty,
        secondary_duty = excluded.secondary_duty,
        supervisor = excluded.supervisor,
        updated_at = datetime('now')
    `
  );

  const insertOperation = db.prepare(
    `
      INSERT INTO operations (sequence, device, stock_code, operation_name, difficulty, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(device, operation_name) DO UPDATE SET
        sequence = excluded.sequence,
        stock_code = excluded.stock_code,
        difficulty = excluded.difficulty,
        updated_at = datetime('now')
    `
  );

  const getPersonnelId = db.prepare("SELECT id FROM personnel WHERE name = ?");
  const getOperationId = db.prepare("SELECT id FROM operations WHERE device = ? AND operation_name = ?");

  const upsertScore = db.prepare(
    `
      INSERT INTO operation_scores (operation_id, personnel_id, target_score, actual_score, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(operation_id, personnel_id) DO UPDATE SET
        target_score = excluded.target_score,
        actual_score = excluded.actual_score,
        updated_at = datetime('now')
    `
  );

  const transaction = db.transaction(() => {
    dutyRows.forEach((row) => {
      if (!row.name) {
        return;
      }

      insertPersonnel.run(row.name, row.mainDuty || "-", row.secondaryDuty || "-", row.supervisor || "-");
    });

    operationRows.forEach((operation) => {
      if (!operation.sequence || !operation.device || !operation.stockCode || !operation.operationName) {
        return;
      }

      const difficulty = Number.isInteger(operation.difficulty) ? operation.difficulty : 1;

      insertOperation.run(
        operation.sequence,
        operation.device,
        operation.stockCode,
        operation.operationName,
        Math.min(5, Math.max(1, difficulty))
      );

      const operationId = getOperationId.get(operation.device, operation.operationName)?.id;
      if (!operationId) {
        return;
      }

      (operation.scores || []).forEach((score) => {
        const personnelId = getPersonnelId.get(score.name)?.id;
        if (!personnelId) {
          return;
        }

        const target = Number.isInteger(score.targetScore) ? score.targetScore : null;
        const actual = Number.isInteger(score.actualScore) ? score.actualScore : null;

        if (target === null && actual === null) {
          return;
        }

        upsertScore.run(operationId, personnelId, target, actual);
      });
    });
  });

  transaction();
  return { personnelCount: dutyRows.length, operationCount: operationRows.length };
}

module.exports = {
  importWorkbookToDb
};


const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");

const WORKBOOK_NAME = "CİHAZ ÜRETİM YETKİNLİK MATRİSİ_20261901.xlsx";
const WORKBOOK_PATH = path.join(__dirname, "..", WORKBOOK_NAME);
const SUCCESS_THRESHOLD = 3;

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

function normalizePersonName(name) {
  return String(name || "")
    .replace(/\s+\(H\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDivide(numerator, denominator) {
  if (!denominator) {
    return null;
  }

  return numerator / denominator;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function parseDutySheet(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const dutyRows = rows.slice(5).filter((row) => String(row[0] || "").trim() !== "");

  return dutyRows.map((row) => ({
    name: normalizePersonName(row[0]),
    mainDuty: String(row[1] || "").trim(),
    secondaryDuty: String(row[2] || "").trim(),
    jobTitle: String(row[3] || "").trim(),
    alternate: normalizePersonName(row[4]),
    supervisor: normalizePersonName(row[5])
  }));
}

function parseOperationsSheet(sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = rows[0] || [];
  const subHeaderRow = rows[1] || [];
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
    const targetLabel = String(subHeaderRow[index] || "").trim().toUpperCase();
    const actualLabel = String(subHeaderRow[index + 1] || "").trim().toUpperCase();

    if (!targetHeader) {
      continue;
    }

    personColumns.push({
      name: targetHeader,
      targetIndex: index,
      actualIndex: index + 1,
      targetLabel,
      actualLabel,
      resolvedName: actualHeader || targetHeader
    });
  }

  const operationRows = dataRows.map((row) => {
    const people = personColumns
      .map((personColumn) => {
        const targetScore = toNumber(row[personColumn.targetIndex]);
        const actualScore = toNumber(row[personColumn.actualIndex]);

        if (targetScore === null && actualScore === null) {
          return null;
        }

        const passed = actualScore !== null && actualScore > SUCCESS_THRESHOLD;

        return {
          name: personColumn.resolvedName,
          targetScore,
          actualScore,
          passed
        };
      })
      .filter(Boolean);

    return {
      sequence: toNumber(row[baseColumns.sequence]),
      device: String(row[baseColumns.device] || "").trim(),
      stockCode: String(row[baseColumns.stockCode] || "").trim(),
      operationName: String(row[baseColumns.operationName] || "").trim(),
      difficulty: toNumber(row[baseColumns.difficulty]),
      people
    };
  });

  return {
    personColumns: personColumns.map((column) => column.resolvedName),
    operationRows
  };
}

function buildEmployeeAnalytics(operationRows, dutyRows) {
  const dutyMap = new Map(dutyRows.map((row) => [row.name, row]));
  const employeeMap = new Map();

  for (const operation of operationRows) {
    for (const score of operation.people) {
      if (!employeeMap.has(score.name)) {
        employeeMap.set(score.name, {
          name: score.name,
          mainDuty: dutyMap.get(score.name)?.mainDuty || null,
          secondaryDuty: dutyMap.get(score.name)?.secondaryDuty || null,
          jobTitle: dutyMap.get(score.name)?.jobTitle || null,
          alternate: dutyMap.get(score.name)?.alternate || null,
          supervisor: dutyMap.get(score.name)?.supervisor || null,
          targetTotal: 0,
          actualTotal: 0,
          successCount: 0,
          failureCount: 0,
          scoredOperationCount: 0,
          operations: []
        });
      }

      const employee = employeeMap.get(score.name);
      const targetScore = score.targetScore;
      const actualScore = score.actualScore;

      employee.operations.push({
        operationName: operation.operationName,
        device: operation.device,
        stockCode: operation.stockCode,
        difficulty: operation.difficulty,
        targetScore,
        actualScore,
        gap: targetScore !== null && actualScore !== null ? round(actualScore - targetScore) : null,
        passed: score.passed
      });

      if (targetScore !== null && actualScore !== null) {
        employee.targetTotal += targetScore;
        employee.actualTotal += actualScore;
        employee.scoredOperationCount += 1;

        if (score.passed) {
          employee.successCount += 1;
        } else {
          employee.failureCount += 1;
        }
      }
    }
  }

  return Array.from(employeeMap.values())
    .map((employee) => ({
      ...employee,
      averageTargetScore: round(safeDivide(employee.targetTotal, employee.scoredOperationCount)),
      averageActualScore: round(safeDivide(employee.actualTotal, employee.scoredOperationCount)),
      operationSuccessRate: round(safeDivide(employee.successCount, employee.scoredOperationCount), 4),
      achievementRate: round(safeDivide(employee.actualTotal, employee.targetTotal), 4),
      gapTotal: round(employee.actualTotal - employee.targetTotal)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

function buildOperationAnalytics(operationRows) {
  return operationRows
    .map((operation) => {
      const scoredPeople = operation.people.filter(
        (person) => person.targetScore !== null && person.actualScore !== null
      );

      const targetTotal = scoredPeople.reduce((sum, person) => sum + person.targetScore, 0);
      const actualTotal = scoredPeople.reduce((sum, person) => sum + person.actualScore, 0);
      const successCount = scoredPeople.filter((person) => person.passed).length;
      const failureCount = scoredPeople.length - successCount;

      return {
        sequence: operation.sequence,
        device: operation.device,
        stockCode: operation.stockCode,
        operationName: operation.operationName,
        difficulty: operation.difficulty,
        participantCount: scoredPeople.length,
        successCount,
        failureCount,
        averageTargetScore: round(safeDivide(targetTotal, scoredPeople.length)),
        averageActualScore: round(safeDivide(actualTotal, scoredPeople.length)),
        operationSuccessRate: round(safeDivide(successCount, scoredPeople.length), 4),
        achievementRate: round(safeDivide(actualTotal, targetTotal), 4),
        people: scoredPeople.map((person) => ({
          name: person.name,
          targetScore: person.targetScore,
          actualScore: person.actualScore,
          gap: round(person.actualScore - person.targetScore),
          passed: person.passed
        }))
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
}

function buildOverview(employeeAnalytics, operationAnalytics, dutyRows, workbookSheetNames, workbookPath) {
  const allScoredOperations = employeeAnalytics.reduce(
    (sum, employee) => sum + employee.scoredOperationCount,
    0
  );
  const totalSuccessCount = employeeAnalytics.reduce((sum, employee) => sum + employee.successCount, 0);
  const totalFailureCount = employeeAnalytics.reduce((sum, employee) => sum + employee.failureCount, 0);

  const topSuccessfulEmployees = [...employeeAnalytics]
    .filter((employee) => employee.scoredOperationCount > 0)
    .sort((left, right) => {
      if (right.operationSuccessRate !== left.operationSuccessRate) {
        return right.operationSuccessRate - left.operationSuccessRate;
      }

      return right.achievementRate - left.achievementRate;
    })
    .slice(0, 5)
    .map((employee) => ({
      name: employee.name,
      mainDuty: employee.mainDuty,
      operationSuccessRate: employee.operationSuccessRate,
      achievementRate: employee.achievementRate
    }));

  const riskOperations = [...operationAnalytics]
    .filter((operation) => operation.participantCount > 0)
    .sort((left, right) => {
      if (left.operationSuccessRate !== right.operationSuccessRate) {
        return left.operationSuccessRate - right.operationSuccessRate;
      }

      return (right.difficulty || 0) - (left.difficulty || 0);
    })
    .slice(0, 5)
    .map((operation) => ({
      operationName: operation.operationName,
      difficulty: operation.difficulty,
      successCount: operation.successCount,
      failureCount: operation.failureCount,
      operationSuccessRate: operation.operationSuccessRate,
      achievementRate: operation.achievementRate
    }));

  return {
    workbookPath,
    sheetNames: workbookSheetNames,
    totalEmployees: employeeAnalytics.length,
    totalDutyAssignments: dutyRows.length,
    totalOperations: operationAnalytics.length,
    totalScoredPairs: allScoredOperations,
    totalSuccessCount,
    totalFailureCount,
    overallOperationSuccessRate: round(
      safeDivide(totalSuccessCount, totalSuccessCount + totalFailureCount),
      4
    ),
    averageAchievementRate: round(
      safeDivide(
        employeeAnalytics.reduce((sum, employee) => sum + (employee.achievementRate || 0), 0),
        employeeAnalytics.filter((employee) => employee.achievementRate !== null).length
      ),
      4
    ),
    topSuccessfulEmployees,
    riskOperations
  };
}

function loadWorkbookAnalytics() {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    throw new Error(`Excel dosyasi bulunamadi: ${WORKBOOK_PATH}`);
  }

  const workbook = xlsx.readFile(WORKBOOK_PATH);
  const dutySheet = workbook.Sheets["Personel Görev Dağılım"];
  const operationsSheet = workbook.Sheets["Tüm Operasyonlar"];

  if (!dutySheet) {
    throw new Error("Personel Görev Dağılım sayfasi bulunamadi");
  }

  if (!operationsSheet) {
    throw new Error("Tüm Operasyonlar sayfasi bulunamadi");
  }

  const dutyRows = parseDutySheet(dutySheet);
  const { operationRows } = parseOperationsSheet(operationsSheet);
  const employeeAnalytics = buildEmployeeAnalytics(operationRows, dutyRows);
  const operationAnalytics = buildOperationAnalytics(operationRows);
  const overview = buildOverview(
    employeeAnalytics,
    operationAnalytics,
    dutyRows,
    workbook.SheetNames,
    WORKBOOK_PATH
  );

  return {
    loadedAt: new Date().toISOString(),
    workbookPath: WORKBOOK_PATH,
    overview,
    employees: employeeAnalytics,
    operations: operationAnalytics
  };
}

module.exports = {
  WORKBOOK_PATH,
  loadWorkbookAnalytics,
  normalizePersonName
};

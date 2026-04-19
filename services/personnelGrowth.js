const fs = require("fs/promises");
const path = require("path");

const TIMEZONE = "Europe/Istanbul";

function getLocalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getNextMidnightDelayMs() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() - now.getTime();
}

function buildSnapshot(analytics, dateKey = getLocalDateKey()) {
  return {
    date: dateKey,
    capturedAt: new Date().toISOString(),
    employees: analytics.employees.map((employee) => ({
      name: employee.name,
      mainDuty: employee.mainDuty || null,
      secondaryDuty: employee.secondaryDuty || null,
      successCount: employee.successCount || 0,
      failureCount: employee.failureCount || 0,
      scoredOperationCount: employee.scoredOperationCount || 0,
      operationSuccessRate: employee.operationSuccessRate || 0,
      achievementRate: employee.achievementRate || 0,
      operations: (employee.operations || [])
        .filter((operation) => operation.targetScore !== null && operation.actualScore !== null)
        .map((operation) => ({
          operationName: operation.operationName,
          device: operation.device,
          difficulty: operation.difficulty,
          targetScore: operation.targetScore,
          actualScore: operation.actualScore,
          gap: operation.gap,
          passed: operation.passed
        }))
    }))
  };
}

async function ensureHistoryFile(historyPath) {
  await fs.mkdir(path.dirname(historyPath), { recursive: true });

  try {
    await fs.access(historyPath);
  } catch (error) {
    await fs.writeFile(historyPath, JSON.stringify({ snapshots: [] }, null, 2));
  }
}

async function readHistory(historyPath) {
  await ensureHistoryFile(historyPath);
  const raw = await fs.readFile(historyPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.snapshots)) {
    throw new Error("Personel gelisim gecmisi dosya formati gecersiz");
  }

  return parsed;
}

async function writeHistory(historyPath, history) {
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
}

async function saveDailySnapshot(historyPath, analytics, dateKey = getLocalDateKey()) {
  const history = await readHistory(historyPath);
  const existingIndex = history.snapshots.findIndex((item) => item.date === dateKey);

  if (existingIndex >= 0) {
    return {
      created: false,
      snapshot: history.snapshots[existingIndex]
    };
  }

  const snapshot = buildSnapshot(analytics, dateKey);
  history.snapshots.push(snapshot);
  history.snapshots.sort((left, right) => left.date.localeCompare(right.date));
  await writeHistory(historyPath, history);
  return {
    created: true,
    snapshot
  };
}

function shiftDateKey(dateKey, dayOffset) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + dayOffset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function clampScore(score) {
  return Math.max(1, Math.min(5, score));
}

function calculateDemoScore(baseScore, employeeIndex, operationIndex, dayIndex, dayCount) {
  if (baseScore === null || baseScore === undefined) {
    return null;
  }

  const maxReduction = (employeeIndex + operationIndex) % 3;
  const progressRatio = dayCount > 1 ? (dayIndex - 1) / (dayCount - 1) : 1;
  const reduction = Math.round(maxReduction * (1 - progressRatio));
  return clampScore(baseScore - reduction);
}

function buildDemoSnapshotFromAnalytics(analytics, dateKey, dayIndex, dayCount) {
  const snapshot = buildSnapshot(analytics, dateKey);

  snapshot.employees = snapshot.employees.map((employee, employeeIndex) => {
    const operations = employee.operations.map((operation, operationIndex) => {
      const actualScore = calculateDemoScore(
        operation.actualScore,
        employeeIndex,
        operationIndex,
        dayIndex,
        dayCount
      );
      const passed = actualScore !== null && actualScore > 3;

      return {
        ...operation,
        actualScore,
        gap: actualScore !== null && operation.targetScore !== null
          ? Number((actualScore - operation.targetScore).toFixed(2))
          : null,
        passed
      };
    });

    const scoredOperations = operations.filter((operation) => operation.targetScore !== null && operation.actualScore !== null);
    const successCount = scoredOperations.filter((operation) => operation.passed).length;
    const failureCount = scoredOperations.length - successCount;
    const targetTotal = scoredOperations.reduce((sum, operation) => sum + operation.targetScore, 0);
    const actualTotal = scoredOperations.reduce((sum, operation) => sum + operation.actualScore, 0);

    return {
      ...employee,
      operations,
      successCount,
      failureCount,
      scoredOperationCount: scoredOperations.length,
      operationSuccessRate: scoredOperations.length ? Number((successCount / scoredOperations.length).toFixed(4)) : 0,
      achievementRate: targetTotal ? Number((actualTotal / targetTotal).toFixed(4)) : 0
    };
  });

  return snapshot;
}

async function seedDemoHistory(historyPath, analytics, dayCount = 5) {
  const todayKey = getLocalDateKey();
  const snapshots = [];

  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const dateKey = shiftDateKey(todayKey, -index);
    snapshots.push(buildDemoSnapshotFromAnalytics(analytics, dateKey, dayCount - index, dayCount));
  }

  await writeHistory(historyPath, { snapshots });
  return snapshots;
}

function compareSnapshots(previousSnapshot, latestSnapshot) {
  if (!previousSnapshot || !latestSnapshot) {
    return {
      summary: {
        latestDate: latestSnapshot?.date || null,
        previousDate: previousSnapshot?.date || null,
        employeeCount: latestSnapshot?.employees?.length || 0,
        improvedOperationCount: 0,
        regressedOperationCount: 0,
        unchangedOperationCount: 0
      },
      employeeChanges: [],
      operationChanges: []
    };
  }

  const previousEmployeeMap = new Map(
    previousSnapshot.employees.map((employee) => [employee.name, employee])
  );

  const employeeChanges = [];
  const operationChanges = [];

  latestSnapshot.employees.forEach((latestEmployee) => {
    const previousEmployee = previousEmployeeMap.get(latestEmployee.name);
    const previousOperationMap = new Map(
      (previousEmployee?.operations || []).map((operation) => [
        `${operation.device}::${operation.operationName}`,
        operation
      ])
    );

    let improvedCount = 0;
    let regressedCount = 0;
    let unchangedCount = 0;
    const changedOperations = [];

    latestEmployee.operations.forEach((operation) => {
      const key = `${operation.device}::${operation.operationName}`;
      const previousOperation = previousOperationMap.get(key);

      if (!previousOperation) {
        return;
      }

      const scoreDelta = (operation.actualScore || 0) - (previousOperation.actualScore || 0);
      const achievementDelta = (operation.targetScore && operation.actualScore !== null && previousOperation.actualScore !== null)
        ? (operation.actualScore / operation.targetScore) - (previousOperation.actualScore / previousOperation.targetScore)
        : 0;

      if (scoreDelta > 0) {
        improvedCount += 1;
      } else if (scoreDelta < 0) {
        regressedCount += 1;
      } else {
        unchangedCount += 1;
      }

      if (scoreDelta !== 0) {
        const record = {
          employeeName: latestEmployee.name,
          mainDuty: latestEmployee.mainDuty,
          device: operation.device,
          operationName: operation.operationName,
          difficulty: operation.difficulty,
          previousScore: previousOperation.actualScore,
          latestScore: operation.actualScore,
          scoreDelta,
          previousTarget: previousOperation.targetScore,
          latestTarget: operation.targetScore,
          achievementDelta
        };

        changedOperations.push(record);
        operationChanges.push(record);
      }
    });

    employeeChanges.push({
      name: latestEmployee.name,
      mainDuty: latestEmployee.mainDuty,
      secondaryDuty: latestEmployee.secondaryDuty,
      previousSuccessRate: previousEmployee?.operationSuccessRate || 0,
      latestSuccessRate: latestEmployee.operationSuccessRate || 0,
      previousAchievementRate: previousEmployee?.achievementRate || 0,
      latestAchievementRate: latestEmployee.achievementRate || 0,
      improvedCount,
      regressedCount,
      unchangedCount,
      changedOperations: changedOperations.sort((left, right) => right.scoreDelta - left.scoreDelta)
    });
  });

  operationChanges.sort((left, right) => {
    if (right.scoreDelta !== left.scoreDelta) {
      return right.scoreDelta - left.scoreDelta;
    }

    return left.employeeName.localeCompare(right.employeeName, "tr");
  });

  employeeChanges.sort((left, right) => {
    if (right.improvedCount !== left.improvedCount) {
      return right.improvedCount - left.improvedCount;
    }

    if (left.regressedCount !== right.regressedCount) {
      return left.regressedCount - right.regressedCount;
    }

    return left.name.localeCompare(right.name, "tr");
  });

  return {
    summary: {
      latestDate: latestSnapshot.date,
      previousDate: previousSnapshot.date,
      employeeCount: latestSnapshot.employees.length,
      improvedOperationCount: operationChanges.filter((item) => item.scoreDelta > 0).length,
      regressedOperationCount: operationChanges.filter((item) => item.scoreDelta < 0).length,
      unchangedOperationCount: employeeChanges.reduce((sum, item) => sum + item.unchangedCount, 0)
    },
    employeeChanges,
    operationChanges
  };
}

function countImprovedOperationsAcrossWindow(snapshots, dayWindow) {
  if (!snapshots.length) {
    return 0;
  }

  const windowSnapshots = snapshots.slice(-dayWindow);
  let improvedCount = 0;

  for (let index = 1; index < windowSnapshots.length; index += 1) {
    const previousSnapshot = windowSnapshots[index - 1];
    const latestSnapshot = windowSnapshots[index];
    const comparison = compareSnapshots(previousSnapshot, latestSnapshot);
    improvedCount += comparison.summary.improvedOperationCount || 0;
  }

  return improvedCount;
}

function buildEmployeeChangesAcrossWindow(snapshots, dayWindow) {
  const windowSnapshots = snapshots.slice(-dayWindow);

  if (windowSnapshots.length < 2) {
    return [];
  }

  const firstSnapshot = windowSnapshots[0];
  const lastSnapshot = windowSnapshots[windowSnapshots.length - 1];
  const aggregateMap = new Map();

  for (let index = 1; index < windowSnapshots.length; index += 1) {
    const comparison = compareSnapshots(windowSnapshots[index - 1], windowSnapshots[index]);

    comparison.employeeChanges.forEach((employee) => {
      if (!aggregateMap.has(employee.name)) {
        aggregateMap.set(employee.name, {
          name: employee.name,
          mainDuty: employee.mainDuty,
          secondaryDuty: employee.secondaryDuty,
          improvedCount: 0,
          regressedCount: 0,
          unchangedCount: 0
        });
      }

      const bucket = aggregateMap.get(employee.name);
      bucket.improvedCount += employee.improvedCount || 0;
      bucket.regressedCount += employee.regressedCount || 0;
      bucket.unchangedCount += employee.unchangedCount || 0;
    });
  }

  const firstEmployeeMap = new Map(firstSnapshot.employees.map((employee) => [employee.name, employee]));
  const lastEmployeeMap = new Map(lastSnapshot.employees.map((employee) => [employee.name, employee]));

  return [...aggregateMap.values()]
    .map((employee) => {
      const firstEmployee = firstEmployeeMap.get(employee.name);
      const lastEmployee = lastEmployeeMap.get(employee.name);

      return {
        ...employee,
        firstSuccessRate: firstEmployee?.operationSuccessRate || 0,
        latestSuccessRate: lastEmployee?.operationSuccessRate || 0,
        firstAchievementRate: firstEmployee?.achievementRate || 0,
        latestAchievementRate: lastEmployee?.achievementRate || 0,
        successRateDelta: (lastEmployee?.operationSuccessRate || 0) - (firstEmployee?.operationSuccessRate || 0),
        achievementRateDelta: (lastEmployee?.achievementRate || 0) - (firstEmployee?.achievementRate || 0)
      };
    })
    .sort((left, right) => {
      if (right.improvedCount !== left.improvedCount) {
        return right.improvedCount - left.improvedCount;
      }

      if (right.successRateDelta !== left.successRateDelta) {
        return right.successRateDelta - left.successRateDelta;
      }

      return left.name.localeCompare(right.name, "tr");
    });
}

async function getGrowthReport(historyPath) {
  const history = await readHistory(historyPath);
  const snapshots = [...history.snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const previousSnapshot = snapshots[snapshots.length - 2] || null;
  const comparison = compareSnapshots(previousSnapshot, latestSnapshot);
  const last7DaysImprovedCount = countImprovedOperationsAcrossWindow(snapshots, 7);
  const last30DaysImprovedCount = countImprovedOperationsAcrossWindow(snapshots, 30);
  const last7DaysEmployeeChanges = buildEmployeeChangesAcrossWindow(snapshots, 7);
  const last30DaysEmployeeChanges = buildEmployeeChangesAcrossWindow(snapshots, 30);
  const timelineMap = new Map();

  snapshots.forEach((snapshot) => {
    snapshot.employees.forEach((employee) => {
      if (!timelineMap.has(employee.name)) {
        timelineMap.set(employee.name, {
          name: employee.name,
          mainDuty: employee.mainDuty,
          points: []
        });
      }

      timelineMap.get(employee.name).points.push({
        date: snapshot.date,
        successRate: employee.operationSuccessRate || 0,
        achievementRate: employee.achievementRate || 0,
        operations: (employee.operations || []).map((operation) => ({
          operationName: operation.operationName,
          device: operation.device,
          targetScore: operation.targetScore,
          actualScore: operation.actualScore,
          passed: operation.passed
        }))
      });
    });
  });

  return {
    snapshotCount: snapshots.length,
    latestSnapshotDate: latestSnapshot?.date || null,
    previousSnapshotDate: previousSnapshot?.date || null,
    last7DaysImprovedCount,
    last30DaysImprovedCount,
    last7DaysEmployeeChanges,
    last30DaysEmployeeChanges,
    snapshots: snapshots.map((snapshot) => ({
      date: snapshot.date,
      capturedAt: snapshot.capturedAt,
      employeeCount: snapshot.employees.length
    })),
    employeeTimeline: [...timelineMap.values()].sort((left, right) => left.name.localeCompare(right.name, "tr")),
    ...comparison
  };
}

module.exports = {
  TIMEZONE,
  getLocalDateKey,
  getNextMidnightDelayMs,
  saveDailySnapshot,
  getGrowthReport,
  seedDemoHistory
};

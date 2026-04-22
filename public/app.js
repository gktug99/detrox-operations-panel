const state = {
  overview: null,
  employees: [],
  operations: [],
  growthReport: null,
  growthLoading: false,
  selectedGrowthEmployee: "",
  selectedGrowthRange: "30d",
  selectedGrowthCustomStart: "",
  selectedGrowthCustomEnd: "",
  selectedGrowthDevice: "all",
  selectedGrowthChangesRange: "30d",
  selectedGrowthChangesCustomStart: "",
  selectedGrowthChangesCustomEnd: "",
  selectedGrowthChangesDevice: "all",
  selectedGrowthChangesDifficulty: "all",
  expandedGrowthOperations: false,
  selectedDifficultyDevice: "all",
  selectedOperationDevice: "all",
  expandedDifficultyDegree: null,
  expandedEmployeeFailuresFor: null,
  expandedEmployeeFailureDevices: {}
};
const SUCCESS_SCORE_THRESHOLD = 3;

function percent(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `%${(value * 100).toFixed(1)}`;
}

function signedPercent(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  const formatted = `%${Math.abs(value * 100).toFixed(1)}`;

  if (value > 0) {
    return `+${formatted}`;
  }

  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

function positiveDelta(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return value > 0 ? value : 0;
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

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: digits
  }).format(value);
}

function isPassed(actualScore) {
  return actualScore !== null && actualScore !== undefined && Number(actualScore) > SUCCESS_SCORE_THRESHOLD;
}

function divideSafe(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function filterGrowthPointsByRange(points, range, customStart, customEnd) {
  if (!points.length) {
    return [];
  }

  if (range === "custom") {
    const start = customStart || points[0].date;
    const end = customEnd || points[points.length - 1].date;
    return points.filter((point) => point.date >= start && point.date <= end);
  }

  if (range === "all") {
    return points;
  }

  const dayWindow = range === "30d" ? 30 : 7;
  return points.slice(-dayWindow);
}

function getFilteredGrowthPoints(points) {
  return filterGrowthPointsByRange(
    points,
    state.selectedGrowthRange,
    state.selectedGrowthCustomStart,
    state.selectedGrowthCustomEnd
  );
}

function analyzeGrowthRange(points) {
  if (points.length < 2) {
    return null;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const firstOperationMap = new Map(
    (firstPoint.operations || []).map((operation) => [`${operation.device}::${operation.operationName}`, operation])
  );
  const lastOperationMap = new Map(
    (lastPoint.operations || []).map((operation) => [`${operation.device}::${operation.operationName}`, operation])
  );
  const comparableKeys = [...lastOperationMap.keys()].filter((key) => firstOperationMap.has(key));
  const improvedOperations = comparableKeys
    .map((key) => {
      const previousOperation = firstOperationMap.get(key);
      const latestOperation = lastOperationMap.get(key);
      const scoreDelta = (latestOperation.actualScore || 0) - (previousOperation.actualScore || 0);
      const previousAchievementRate = divideSafe(previousOperation.actualScore || 0, previousOperation.targetScore || 0);
      const currentAchievementRate = divideSafe(latestOperation.actualScore || 0, latestOperation.targetScore || 0);

      return {
        device: latestOperation.device,
        operationName: latestOperation.operationName,
        previousScore: previousOperation.actualScore,
        currentScore: latestOperation.actualScore,
        scoreDelta,
        previousAchievementRate,
        currentAchievementRate,
        achievementRateDelta: (currentAchievementRate || 0) - (previousAchievementRate || 0)
      };
    })
    .filter((operation) => operation.scoreDelta > 0)
    .sort((left, right) => {
      if (right.scoreDelta !== left.scoreDelta) {
        return right.scoreDelta - left.scoreDelta;
      }

      return left.operationName.localeCompare(right.operationName, "tr");
    });

  const firstSuccessfulCount = (firstPoint.operations || []).filter((operation) => operation.passed).length;
  const lastSuccessfulCount = (lastPoint.operations || []).filter((operation) => operation.passed).length;

  return {
    firstPoint,
    lastPoint,
    comparableOperationCount: comparableKeys.length,
    improvedCount: improvedOperations.length,
    improvedRate: divideSafe(improvedOperations.length, comparableKeys.length),
    firstSuccessfulCount,
    lastSuccessfulCount,
    successfulCountDelta: lastSuccessfulCount - firstSuccessfulCount,
    successRateDelta: (lastPoint.successRate || 0) - (firstPoint.successRate || 0),
    achievementRateDelta: (lastPoint.achievementRate || 0) - (firstPoint.achievementRate || 0),
    improvedOperations
  };
}

function getGrowthChangeDateRange(report) {
  const snapshotDates = (report?.snapshots || []).map((snapshot) => snapshot.date).filter(Boolean);

  if (snapshotDates.length) {
    return snapshotDates;
  }

  const firstTimeline = report?.employeeTimeline?.[0]?.points || [];
  return firstTimeline.map((point) => point.date).filter(Boolean);
}

function getFilteredGrowthChangeDates(report) {
  const dates = getGrowthChangeDateRange(report);

  if (!dates.length) {
    return [];
  }

  if (state.selectedGrowthChangesRange === "custom") {
    const start = state.selectedGrowthChangesCustomStart || dates[0];
    const end = state.selectedGrowthChangesCustomEnd || dates[dates.length - 1];
    return dates.filter((date) => date >= start && date <= end);
  }

  if (state.selectedGrowthChangesRange === "all") {
    return dates;
  }

  const dayWindow = state.selectedGrowthChangesRange === "30d" ? 30 : 7;
  return dates.slice(-dayWindow);
}

function buildOperationGrowthRows(report) {
  const timelines = report?.employeeTimeline || [];

  if (!timelines.length) {
    return [];
  }

  const aggregateMap = new Map();

  timelines.forEach((employee) => {
    const filteredPoints = filterGrowthPointsByRange(
      employee.points || [],
      state.selectedGrowthChangesRange,
      state.selectedGrowthChangesCustomStart,
      state.selectedGrowthChangesCustomEnd
    );

    if (filteredPoints.length < 2) {
      return;
    }

    const firstPoint = filteredPoints[0];
    const lastPoint = filteredPoints[filteredPoints.length - 1];
    const firstOperationMap = new Map(
      (firstPoint.operations || []).map((operation) => [`${operation.device}::${operation.operationName}`, operation])
    );

    (lastPoint.operations || []).forEach((latestOperation) => {
      const key = `${latestOperation.device}::${latestOperation.operationName}`;
      const previousOperation = firstOperationMap.get(key);

      if (!previousOperation) {
        return;
      }

      if (
        previousOperation.targetScore === null ||
        previousOperation.actualScore === null ||
        latestOperation.targetScore === null ||
        latestOperation.actualScore === null
      ) {
        return;
      }

      if (!aggregateMap.has(key)) {
        aggregateMap.set(key, {
          key,
          device: latestOperation.device,
          operationName: latestOperation.operationName,
          difficulty: latestOperation.difficulty ?? previousOperation.difficulty ?? null,
          targetedPeopleCount: 0,
          improvedPeopleCount: 0,
          firstSuccessfulCount: 0,
          lastSuccessfulCount: 0
        });
      }

      const aggregate = aggregateMap.get(key);
      const previousPassed = isPassed(previousOperation.actualScore);
      const latestPassed = isPassed(latestOperation.actualScore);
      const scoreDelta = (latestOperation.actualScore || 0) - (previousOperation.actualScore || 0);

      aggregate.targetedPeopleCount += 1;
      aggregate.firstSuccessfulCount += previousPassed ? 1 : 0;
      aggregate.lastSuccessfulCount += latestPassed ? 1 : 0;

      if (scoreDelta > 0) {
        aggregate.improvedPeopleCount += 1;
      }
    });
  });

  return [...aggregateMap.values()]
    .map((item) => {
      const improvedPeopleRate = divideSafe(item.improvedPeopleCount, item.targetedPeopleCount);
      const firstSuccessRate = divideSafe(item.firstSuccessfulCount, item.targetedPeopleCount) || 0;
      const lastSuccessRate = divideSafe(item.lastSuccessfulCount, item.targetedPeopleCount) || 0;

      return {
        ...item,
        improvedPeopleRate,
        firstSuccessRate,
        lastSuccessRate,
        successRateDelta: lastSuccessRate - firstSuccessRate
      };
    })
    .filter((item) => item.targetedPeopleCount > 0);
}

function clampScore(value) {
  return Math.max(1, Math.min(5, value));
}

function getDateKeyBeforeToday(dayOffset) {
  const date = new Date();
  date.setDate(date.getDate() - dayOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deriveEmployeeMetrics(employee) {
  const operations = employee.operations.map((operation) => ({
    ...operation,
    passed: isPassed(operation.actualScore)
  }));
  const scoredOperations = operations.filter(
    (operation) => operation.targetScore !== null && operation.actualScore !== null
  );
  const targetTotal = scoredOperations.reduce((sum, operation) => sum + operation.targetScore, 0);
  const actualTotal = scoredOperations.reduce((sum, operation) => sum + operation.actualScore, 0);
  const successCount = scoredOperations.filter((operation) => operation.passed).length;
  const failureCount = scoredOperations.length - successCount;

  return {
    ...employee,
    operations,
    targetTotal,
    actualTotal,
    successCount,
    failureCount,
    scoredOperationCount: scoredOperations.length,
    operationSuccessRate: divideSafe(successCount, scoredOperations.length),
    achievementRate: divideSafe(actualTotal, targetTotal)
  };
}

function deriveOperationMetrics(operation) {
  const people = operation.people
    .filter((person) => person.targetScore !== null && person.actualScore !== null)
    .map((person) => ({
      ...person,
      passed: isPassed(person.actualScore),
      gap: person.gap ?? (person.actualScore !== null && person.targetScore !== null
        ? person.actualScore - person.targetScore
        : null)
    }));
  const targetTotal = people.reduce((sum, person) => sum + person.targetScore, 0);
  const actualTotal = people.reduce((sum, person) => sum + person.actualScore, 0);
  const successCount = people.filter((person) => person.passed).length;
  const failureCount = people.length - successCount;

  return {
    ...operation,
    people,
    participantCount: people.length,
    successCount,
    failureCount,
    operationSuccessRate: divideSafe(successCount, people.length),
    achievementRate: divideSafe(actualTotal, targetTotal)
  };
}

function deriveOverviewMetrics() {
  const employees = state.employees.map((employee) => deriveEmployeeMetrics(employee));
  const operations = state.operations.map((operation) => deriveOperationMetrics(operation));
  const totalSuccessCount = employees.reduce((sum, employee) => sum + employee.successCount, 0);
  const totalFailureCount = employees.reduce((sum, employee) => sum + employee.failureCount, 0);
  const achievementEmployees = employees.filter((employee) => employee.achievementRate !== null);

  return {
    totalEmployees: employees.length,
    totalOperations: operations.length,
    overallOperationSuccessRate: divideSafe(totalSuccessCount, totalSuccessCount + totalFailureCount),
    averageAchievementRate: divideSafe(
      achievementEmployees.reduce((sum, employee) => sum + employee.achievementRate, 0),
      achievementEmployees.length
    ),
    topSuccessfulEmployees: [...employees]
      .filter((employee) => employee.scoredOperationCount > 0)
      .sort((left, right) => {
        if ((right.operationSuccessRate || 0) !== (left.operationSuccessRate || 0)) {
          return (right.operationSuccessRate || 0) - (left.operationSuccessRate || 0);
        }

        return (right.achievementRate || 0) - (left.achievementRate || 0);
      })
      .slice(0, 5),
    riskOperations: [...operations]
      .filter((operation) => (
        operation.participantCount > 0 &&
        (operation.difficulty || 0) >= 4 &&
        (operation.operationSuccessRate || 0) < 0.5
      ))
      .sort((left, right) => {
        if ((left.operationSuccessRate || 0) !== (right.operationSuccessRate || 0)) {
          return (left.operationSuccessRate || 0) - (right.operationSuccessRate || 0);
        }

        return (right.difficulty || 0) - (left.difficulty || 0);
      })
      .slice(0, 5)
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function setStatus(message) {
  document.getElementById("statusMessage").textContent = message;
}

function initializeViewTabs() {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.onclick = () => {
      const targetId = button.dataset.viewTarget;

      document.querySelectorAll(".view-tab").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });

      document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === targetId);
      });

      if (targetId === "growthView") {
        refreshGrowthDashboard();
      }
    };
  });
}

function createSummaryCard(label, value) {
  const element = document.createElement("article");
  element.className = "summary-card";
  element.innerHTML = `<label>${label}</label><strong>${value}</strong>`;
  return element;
}

function renderSummary() {
  const cards = document.getElementById("summaryCards");
  cards.innerHTML = "";
  const overview = deriveOverviewMetrics();

  const entries = [
    ["Toplam Personel Sayısı", formatNumber(overview.totalEmployees, 0)],
    ["Toplam Operasyon Sayısı", formatNumber(overview.totalOperations, 0)],
    ["Genel Başarı Oranı", percent(overview.overallOperationSuccessRate)],
    ["Hedef Gerçekleşme Oranı", percent(overview.averageAchievementRate)]
  ];

  entries.forEach(([label, value]) => cards.appendChild(createSummaryCard(label, value)));
}

function renderRiskOperations() {
  const container = document.getElementById("riskOperations");
  container.innerHTML = "";
  const overview = deriveOverviewMetrics();

  overview.riskOperations.forEach((operation) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <strong>${escapeHtml(operation.operationName)}</strong>
      <div class="metric-row">
        <span>Zorluk: ${formatNumber(operation.difficulty, 0)}</span>
        <span>Başarı: ${percent(operation.operationSuccessRate)}</span>
        <span>Hedef Gerçekleşme: ${percent(operation.achievementRate)}</span>
        <span>Başarısız: ${formatNumber(operation.failureCount, 0)}</span>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderTopEmployees() {
  const container = document.getElementById("topEmployees");
  container.innerHTML = "";
  const overview = deriveOverviewMetrics();

  overview.topSuccessfulEmployees.forEach((employee) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <strong>${escapeHtml(employee.name)}</strong>
      <div class="metric-row">
        <span>Ana görev: ${escapeHtml(employee.mainDuty || "-")}</span>
        <span>Hedefi olan operasyon sayısı: ${formatNumber(employee.scoredOperationCount, 0)}</span>
        <span>Operasyon başarısı: ${percent(employee.operationSuccessRate)}</span>
        <span>Hedef gerçekleşme: ${percent(employee.achievementRate)}</span>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderGrowthSummary() {
  const container = document.getElementById("growthSummary");
  const report = state.growthReport;

  if (!report || !report.summary) {
    container.innerHTML = `<p class="empty-state">Gelişim özeti henüz oluşmadı.</p>`;
    return;
  }

  if ((report.snapshotCount || 0) < 2) {
    container.innerHTML = `
      <p class="empty-state">
        Personel gelişimi karşılaştırması için en az 2 günlük kayıt gereklidir.
        Sistem her gün saat 00:00'da Excel verisinin tek bir günlük kaydını oluşturur.
      </p>
    `;
    return;
  }

  const derivedLast7 = report.last7DaysEmployeeChanges?.reduce(
    (sum, employee) => sum + (employee.improvedCount || 0),
    0
  ) || 0;
  const derivedLast30 = report.last30DaysEmployeeChanges?.reduce(
    (sum, employee) => sum + (employee.improvedCount || 0),
    0
  ) || 0;
  const last7Value = (report.last7DaysImprovedCount || 0) > 0 ? report.last7DaysImprovedCount : derivedLast7;
  const last30Value = (report.last30DaysImprovedCount || 0) > 0 ? report.last30DaysImprovedCount : derivedLast30;

  container.innerHTML = `
    <div class="detail-bubble-grid">
      <article class="detail-bubble detail-bubble-metric">
        <label>Son günlük kayıt</label>
        <strong>${escapeHtml(report.summary.latestDate || "-")}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Son 7 Günlük Gelişim Adedi</label>
        <strong>${formatNumber(last7Value, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Son 30 Günlük Gelişim Adedi</label>
        <strong>${formatNumber(last30Value, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Toplam Kayıt Sayısı</label>
        <strong>${formatNumber(report.snapshotCount, 0)}</strong>
      </article>
    </div>
  `;
}

function renderGrowthEmployees() {
  const container = document.getElementById("growthEmployees");
  const report = state.growthReport;

  if ((report?.snapshotCount || 0) < 2) {
    container.innerHTML = `<p class="empty-state">İlk karşılaştırma, ikinci günlük kayıt oluştuktan sonra görüntülenecektir.</p>`;
    return;
  }

  if (!report || !report.last30DaysEmployeeChanges?.length) {
    if (!report?.employeeChanges?.length) {
      container.innerHTML = `<p class="empty-state">Personel gelişim verisi henüz oluşmadı.</p>`;
      return;
    }
  }

  const rowsSource = report.last30DaysEmployeeChanges?.length
    ? report.last30DaysEmployeeChanges
    : report.employeeChanges;

  const filteredRows = rowsSource.filter(
    (employee) => (employee.improvedCount || 0) > 0 || (employee.regressedCount || 0) > 0
  );
  const rows = (filteredRows.length ? filteredRows : rowsSource).slice(0, 10);

  container.innerHTML = rows.length
    ? rows.map((employee) => `
        <div class="list-item">
          <strong>${escapeHtml(employee.name)}</strong>
          <div class="metric-row">
            <span>Ana görev: ${escapeHtml(employee.mainDuty || "-")}</span>
            <span>Gelişim Adedi: ${formatNumber(employee.improvedCount, 0)}</span>
            <span>Başarı Oranı Artışı: ${signedPercent(positiveDelta(employee.successRateDelta))}</span>
            <span>Hedef Gerçekleştirme Oranı Artışı: ${signedPercent(positiveDelta(employee.achievementRateDelta))}</span>
          </div>
        </div>
      `).join("")
    : `<p class="empty-state">Gelişim gösteren personel bulunamadı.</p>`;
}

function renderGrowthEmployeeSelect() {
  const select = document.getElementById("growthEmployeeSelect");
  const rangeSelect = document.getElementById("growthRangeSelect");
  const customStartSelect = document.getElementById("growthCustomStartSelect");
  const customEndSelect = document.getElementById("growthCustomEndSelect");
  const customStartControl = document.getElementById("growthCustomStartControl");
  const customEndControl = document.getElementById("growthCustomEndControl");
  const timeline = state.growthReport?.employeeTimeline || [];

  if ((state.growthReport?.snapshotCount || 0) < 2) {
    select.innerHTML = `<option value="">Henüz günlük karşılaştırma kaydı yok</option>`;
    rangeSelect.innerHTML = `<option value="30d">Son 1 Ay</option>`;
    customStartSelect.innerHTML = "";
    customEndSelect.innerHTML = "";
    customStartControl.hidden = true;
    customEndControl.hidden = true;
    state.selectedGrowthEmployee = "";
    renderGrowthTimeline();
    return;
  }

  select.innerHTML = timeline
    .map((employee) => `<option value="${escapeHtml(employee.name)}">${escapeHtml(employee.name)}</option>`)
    .join("");

  if (!timeline.length) {
    state.selectedGrowthEmployee = "";
    renderGrowthTimeline();
    return;
  }

  if (!state.selectedGrowthEmployee || !timeline.some((item) => item.name === state.selectedGrowthEmployee)) {
    state.selectedGrowthEmployee = timeline[0].name;
  }

  select.value = state.selectedGrowthEmployee;
  select.onchange = () => {
    state.selectedGrowthEmployee = select.value;
    state.selectedGrowthDevice = "all";
    state.expandedGrowthOperations = false;
    syncGrowthCustomDateControls();
    renderGrowthTimeline();
  };

  rangeSelect.innerHTML = `
    <option value="7d">Son 1 Hafta</option>
    <option value="30d">Son 1 Ay</option>
    <option value="custom">Özel Tarih</option>
  `;

  if (!["7d", "30d", "custom"].includes(state.selectedGrowthRange)) {
    state.selectedGrowthRange = "7d";
  }

  rangeSelect.value = state.selectedGrowthRange;
  rangeSelect.onchange = () => {
    state.selectedGrowthRange = rangeSelect.value;
    state.selectedGrowthDevice = "all";
    state.expandedGrowthOperations = false;
    syncGrowthCustomDateControls();
    renderGrowthTimeline();
  };

  customStartSelect.onchange = () => {
    state.selectedGrowthCustomStart = customStartSelect.value;

    if (state.selectedGrowthCustomEnd && state.selectedGrowthCustomEnd < state.selectedGrowthCustomStart) {
      state.selectedGrowthCustomEnd = state.selectedGrowthCustomStart;
    }

    state.selectedGrowthDevice = "all";
    state.expandedGrowthOperations = false;
    syncGrowthCustomDateControls();
    renderGrowthTimeline();
  };

  customEndSelect.onchange = () => {
    state.selectedGrowthCustomEnd = customEndSelect.value;

    if (state.selectedGrowthCustomStart && state.selectedGrowthCustomEnd < state.selectedGrowthCustomStart) {
      state.selectedGrowthCustomStart = state.selectedGrowthCustomEnd;
    }

    state.selectedGrowthDevice = "all";
    state.expandedGrowthOperations = false;
    syncGrowthCustomDateControls();
    renderGrowthTimeline();
  };

  syncGrowthCustomDateControls();
}

function syncGrowthCustomDateControls() {
  const timeline = state.growthReport?.employeeTimeline || [];
  const employee = timeline.find((item) => item.name === state.selectedGrowthEmployee);
  const customStartSelect = document.getElementById("growthCustomStartSelect");
  const customEndSelect = document.getElementById("growthCustomEndSelect");
  const customStartControl = document.getElementById("growthCustomStartControl");
  const customEndControl = document.getElementById("growthCustomEndControl");
  const points = employee?.points || [];

  customStartControl.hidden = state.selectedGrowthRange !== "custom";
  customEndControl.hidden = state.selectedGrowthRange !== "custom";

  if (!points.length) {
    customStartSelect.innerHTML = "";
    customEndSelect.innerHTML = "";
    return;
  }

  if (!state.selectedGrowthCustomStart || !points.some((point) => point.date === state.selectedGrowthCustomStart)) {
    state.selectedGrowthCustomStart = points[0].date;
  }

  if (!state.selectedGrowthCustomEnd || !points.some((point) => point.date === state.selectedGrowthCustomEnd)) {
    state.selectedGrowthCustomEnd = points[points.length - 1].date;
  }

  if (state.selectedGrowthCustomEnd < state.selectedGrowthCustomStart) {
    state.selectedGrowthCustomEnd = state.selectedGrowthCustomStart;
  }

  customStartSelect.innerHTML = points
    .map((point) => `<option value="${escapeHtml(point.date)}">${escapeHtml(point.date)}</option>`)
    .join("");

  customEndSelect.innerHTML = points
    .filter((point) => point.date >= state.selectedGrowthCustomStart)
    .map((point) => `<option value="${escapeHtml(point.date)}">${escapeHtml(point.date)}</option>`)
    .join("");

  customStartSelect.value = state.selectedGrowthCustomStart;
  customEndSelect.value = state.selectedGrowthCustomEnd;
}

function renderGrowthTimeline() {
  const container = document.getElementById("growthTimeline");
  const timeline = state.growthReport?.employeeTimeline || [];
  const employee = timeline.find((item) => item.name === state.selectedGrowthEmployee);

  if ((state.growthReport?.snapshotCount || 0) < 2) {
    container.innerHTML = `<p class="empty-state">Zaman grafiği, ikinci günlük kayıt oluştuktan sonra aktif olacaktır.</p>`;
    return;
  }

  if (!employee) {
    container.innerHTML = `<p class="empty-state">Grafik için personel seçimi bekleniyor.</p>`;
    return;
  }

  const filteredPoints = getFilteredGrowthPoints(employee.points);
  const analysis = analyzeGrowthRange(filteredPoints);

  if (!filteredPoints.length) {
    container.innerHTML = `<p class="empty-state">Seçilen tarih aralığında gösterilecek kayıt bulunamadı.</p>`;
    return;
  }

  if (!analysis) {
    container.innerHTML = `<p class="empty-state">Bu aralıkta karşılaştırma yapabilmek için en az 2 kayıt gereklidir.</p>`;
    return;
  }

  const visibleOperations = state.expandedGrowthOperations
    ? analysis.improvedOperations
    : analysis.improvedOperations.slice(0, 5);
  const rangeLabel = state.selectedGrowthRange === "7d"
    ? "Son 1 Hafta"
    : state.selectedGrowthRange === "30d"
      ? "Son 1 Ay"
      : "Özel Tarih";
  const deviceOptions = [...new Set(analysis.improvedOperations.map((operation) => operation.device))]
    .sort((left, right) => left.localeCompare(right, "tr"));

  if (
    state.selectedGrowthDevice !== "all" &&
    !deviceOptions.includes(state.selectedGrowthDevice)
  ) {
    state.selectedGrowthDevice = "all";
  }

  const filteredOperations = visibleOperations.filter((operation) => (
    state.selectedGrowthDevice === "all" || operation.device === state.selectedGrowthDevice
  ));
  const deviceScopedOperations = analysis.improvedOperations.filter((operation) => (
    state.selectedGrowthDevice === "all" || operation.device === state.selectedGrowthDevice
  ));
  const deviceAchievementDeltaAverage = divideSafe(
    deviceScopedOperations.reduce((sum, operation) => sum + (operation.achievementRateDelta || 0), 0),
    deviceScopedOperations.length
  );
  const deviceLabel = state.selectedGrowthDevice === "all"
    ? "Tüm cihazlar"
    : state.selectedGrowthDevice;

  container.innerHTML = `
    <div class="section-title-row">
      <strong>${escapeHtml(rangeLabel)} Aralık Özeti</strong>
      <span>${escapeHtml(analysis.firstPoint.date)} ile ${escapeHtml(analysis.lastPoint.date)} arasındaki kayıtlar karşılaştırılmaktadır.</span>
    </div>
    <div class="detail-bubble-grid detail-bubble-grid-metrics">
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarılı Operasyon Sayısı</label>
        <strong>${formatNumber(analysis.firstSuccessfulCount, 0)} -> ${formatNumber(analysis.lastSuccessfulCount, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarılı Operasyon Sayısı Artışı</label>
        <strong>${analysis.successfulCountDelta > 0 ? "+" : ""}${formatNumber(positiveDelta(analysis.successfulCountDelta), 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarı Oranı</label>
        <strong>${percent(analysis.firstPoint.successRate)} -> ${percent(analysis.lastPoint.successRate)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarı Oranı Artışı</label>
        <strong>${signedPercent(positiveDelta(analysis.successRateDelta))}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Hedef Gerçekleştirme Oranı</label>
        <strong>${percent(analysis.firstPoint.achievementRate)} -> ${percent(analysis.lastPoint.achievementRate)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Hedef Gerçekleştirme Oranı Artışı</label>
        <strong>${signedPercent(positiveDelta(analysis.achievementRateDelta))}</strong>
      </article>
    </div>
    <div class="section-title-row">
      <strong>Gelişim Gösterdiği Operasyonlar</strong>
      <span>Seçilen aralıkta puanı yükselen operasyonlar listelenmektedir.</span>
    </div>
    <div class="toolbar">
      <select id="growthDeviceSelect">
        <option value="all">Tüm Cihazlar</option>
        ${deviceOptions.map((device) => `<option value="${escapeHtml(device)}">${escapeHtml(device)}</option>`).join("")}
      </select>
    </div>
    <div class="detail-bubble-grid detail-bubble-grid-metrics">
      <article class="detail-bubble detail-bubble-metric">
        <label>${escapeHtml(deviceLabel)} İçin Gelişen Operasyon Sayısı</label>
        <strong>${formatNumber(deviceScopedOperations.length, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>${escapeHtml(deviceLabel)} İçin Ortalama Hedef Gerçekleştirme Artışı</label>
        <strong>${signedPercent(positiveDelta(deviceAchievementDeltaAverage))}</strong>
      </article>
    </div>
    ${filteredOperations.length
      ? `
        <table class="detail-table">
          <thead>
            <tr>
              <th>Cihaz</th>
              <th>Operasyon</th>
              <th>Önceki Puan</th>
              <th>Güncel Puan</th>
              <th>Puan Değişimi</th>
              <th>Güncel Hedef Gerçekleştirme</th>
              <th>Hedef Gerçekleştirmedeki Değişim</th>
            </tr>
          </thead>
          <tbody>
            ${filteredOperations.map((operation) => `
              <tr>
                <td>${escapeHtml(operation.device)}</td>
                <td>${escapeHtml(operation.operationName)}</td>
                <td>${formatNumber(operation.previousScore, 0)}</td>
                <td>${formatNumber(operation.currentScore, 0)}</td>
                <td>${operation.scoreDelta > 0 ? "+" : ""}${formatNumber(operation.scoreDelta, 0)}</td>
                <td>${percent(operation.currentAchievementRate)}</td>
                <td>${signedPercent(operation.achievementRateDelta)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : `<p class="empty-state">Seçilen cihaz filtresinde gelişim gösteren operasyon bulunamadı.</p>`}
    ${analysis.improvedOperations.length > 5 ? `
      <div class="metric-row">
        <button id="toggleGrowthOperationsButton" class="mini-button" type="button">
          ${state.expandedGrowthOperations ? "Daha Az Göster" : "Tümünü Göster"}
        </button>
      </div>
    ` : ""}
  `;

  const toggleButton = document.getElementById("toggleGrowthOperationsButton");
  const deviceSelect = document.getElementById("growthDeviceSelect");

  if (deviceSelect) {
    deviceSelect.value = state.selectedGrowthDevice;
    deviceSelect.onchange = () => {
      state.selectedGrowthDevice = deviceSelect.value;
      renderGrowthTimeline();
    };
  }

  if (toggleButton) {
    toggleButton.onclick = () => {
      state.expandedGrowthOperations = !state.expandedGrowthOperations;
      renderGrowthTimeline();
    };
  }
}

async function fetchJsonOrThrow(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${url} -> ${payload.error || "Istek basarisiz oldu."}`);
  }

  return payload;
}

function setGrowthPanelMessage(message) {
  const markup = `<p class="empty-state">${escapeHtml(message)}</p>`;
  document.getElementById("growthSummary").innerHTML = markup;
  document.getElementById("growthEmployees").innerHTML = markup;
  document.getElementById("growthTimeline").innerHTML = markup;
  document.getElementById("growthChanges").innerHTML = markup;
}

async function refreshGrowthDashboard() {
  if (state.growthLoading) {
    return;
  }

  state.growthLoading = true;

  try {
    state.growthReport = state.overview?.growthReport || null;

    if (!state.growthReport?.summary) {
      if (!state.employees.length) {
        throw new Error("Personel gelisimi raporu olusturulamadi.");
      }

      state.growthReport = buildFrontendGrowthReport(state.employees);
      setStatus("Personel gelisimi icin yedek demo kayitlari gosteriliyor...");
    }

    renderGrowthSummary();
    renderGrowthEmployees();
    renderGrowthEmployeeSelect();
    renderGrowthTimeline();
    renderGrowthChanges();
  } catch (error) {
    state.growthReport = null;
    setGrowthPanelMessage(`Personel gelisimi verileri yuklenemedi: ${error.message}`);
  } finally {
    state.growthLoading = false;
  }
}

function buildFrontendGrowthReport(employees) {
  const dayCount = 30;
  const snapshots = [];

  for (let dayIndex = dayCount - 1; dayIndex >= 0; dayIndex -= 1) {
    const date = getDateKeyBeforeToday(dayIndex);
    const employeeRows = employees.map((employee, employeeIndex) => {
      const scoredOperations = employee.operations.filter(
        (operation) => operation.targetScore !== null && operation.actualScore !== null
      );

      const syntheticOperations = scoredOperations.map((operation, operationIndex) => {
        const actualScore = calculateDemoScore(
          operation.actualScore,
          employeeIndex,
          operationIndex,
          dayCount - dayIndex,
          dayCount
        );
        return {
          operationName: operation.operationName,
          device: operation.device,
          difficulty: operation.difficulty,
          targetScore: operation.targetScore,
          actualScore,
          passed: isPassed(actualScore)
        };
      });

      const successCount = syntheticOperations.filter((operation) => operation.passed).length;
      const targetTotal = syntheticOperations.reduce((sum, operation) => sum + operation.targetScore, 0);
      const actualTotal = syntheticOperations.reduce((sum, operation) => sum + operation.actualScore, 0);

      return {
        name: employee.name,
        mainDuty: employee.mainDuty || null,
        secondaryDuty: employee.secondaryDuty || null,
        operationSuccessRate: divideSafe(successCount, syntheticOperations.length) || 0,
        achievementRate: divideSafe(actualTotal, targetTotal) || 0,
        operations: syntheticOperations,
      };
    });

    snapshots.push({ date, employees: employeeRows });
  }

  const latestSnapshot = snapshots[snapshots.length - 1];
  const previousSnapshot = snapshots[snapshots.length - 2];
  const previousEmployeeMap = new Map(previousSnapshot.employees.map((employee) => [employee.name, employee]));
  const employeeChanges = [];
  const operationChanges = [];

  latestSnapshot.employees.forEach((employee) => {
    const previousEmployee = previousEmployeeMap.get(employee.name);
    const previousOperations = new Map(
      (previousEmployee?.operations || []).map((operation) => [`${operation.device}::${operation.operationName}`, operation])
    );

    let improvedCount = 0;
    let regressedCount = 0;
    let unchangedCount = 0;

    employee.operations.forEach((operation) => {
      const previousOperation = previousOperations.get(`${operation.device}::${operation.operationName}`);

      if (!previousOperation) {
        return;
      }

      const scoreDelta = operation.actualScore - previousOperation.actualScore;

      if (scoreDelta > 0) {
        improvedCount += 1;
      } else if (scoreDelta < 0) {
        regressedCount += 1;
      } else {
        unchangedCount += 1;
      }

      if (scoreDelta !== 0) {
        operationChanges.push({
          employeeName: employee.name,
          mainDuty: employee.mainDuty,
          device: operation.device,
          operationName: operation.operationName,
          difficulty: operation.difficulty,
          previousScore: previousOperation.actualScore,
          latestScore: operation.actualScore,
          scoreDelta
        });
      }
    });

    employeeChanges.push({
      name: employee.name,
      mainDuty: employee.mainDuty,
      secondaryDuty: employee.secondaryDuty,
      previousSuccessRate: previousEmployee?.operationSuccessRate || 0,
      latestSuccessRate: employee.operationSuccessRate || 0,
      previousAchievementRate: previousEmployee?.achievementRate || 0,
      latestAchievementRate: employee.achievementRate || 0,
      improvedCount,
      regressedCount,
      unchangedCount
    });
  });

  employeeChanges.sort((left, right) => {
    if (right.improvedCount !== left.improvedCount) {
      return right.improvedCount - left.improvedCount;
    }

    return left.name.localeCompare(right.name, "tr");
  });

  operationChanges.sort((left, right) => {
    if (right.scoreDelta !== left.scoreDelta) {
      return right.scoreDelta - left.scoreDelta;
    }

    return left.employeeName.localeCompare(right.employeeName, "tr");
  });

  function compareFrontendSnapshots(previous, latest) {
    const previousEmployeeLookup = new Map(previous.employees.map((employee) => [employee.name, employee]));
    const localEmployeeChanges = [];
    const localOperationChanges = [];

    latest.employees.forEach((employee) => {
      const previousEmployee = previousEmployeeLookup.get(employee.name);
      const previousOperations = new Map(
        (previousEmployee?.operations || []).map((operation) => [`${operation.device}::${operation.operationName}`, operation])
      );

      let improvedCount = 0;
      let regressedCount = 0;
      let unchangedCount = 0;

      employee.operations.forEach((operation) => {
        const previousOperation = previousOperations.get(`${operation.device}::${operation.operationName}`);

        if (!previousOperation) {
          return;
        }

        const scoreDelta = (operation.actualScore || 0) - (previousOperation.actualScore || 0);

        if (scoreDelta > 0) {
          improvedCount += 1;
        } else if (scoreDelta < 0) {
          regressedCount += 1;
        } else {
          unchangedCount += 1;
        }

        if (scoreDelta !== 0) {
          localOperationChanges.push({ scoreDelta });
        }
      });

      localEmployeeChanges.push({
        name: employee.name,
        mainDuty: employee.mainDuty,
        secondaryDuty: employee.secondaryDuty,
        previousSuccessRate: previousEmployee?.operationSuccessRate || 0,
        latestSuccessRate: employee.operationSuccessRate || 0,
        improvedCount,
        regressedCount,
        unchangedCount
      });
    });

    return {
      employeeChanges: localEmployeeChanges,
      operationChanges: localOperationChanges
    };
  }

  function aggregateFrontendWindow(dayWindow) {
    const windowSnapshots = snapshots.slice(-dayWindow);

    if (windowSnapshots.length < 2) {
      return {
        improvedCount: 0,
        employeeChanges: []
      };
    }

    let improvedCount = 0;
    const aggregateMap = new Map();
    const firstSnapshotInWindow = windowSnapshots[0];
    const lastSnapshotInWindow = windowSnapshots[windowSnapshots.length - 1];

    for (let index = 1; index < windowSnapshots.length; index += 1) {
      const comparison = compareFrontendSnapshots(windowSnapshots[index - 1], windowSnapshots[index]);
      improvedCount += comparison.operationChanges.filter((item) => item.scoreDelta > 0).length;

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

    const firstEmployeeMap = new Map(firstSnapshotInWindow.employees.map((employee) => [employee.name, employee]));
    const lastEmployeeMap = new Map(lastSnapshotInWindow.employees.map((employee) => [employee.name, employee]));

      const employeeChanges = [...aggregateMap.values()]
      .map((employee) => {
        const firstEmployee = firstEmployeeMap.get(employee.name);
        const lastEmployee = lastEmployeeMap.get(employee.name);

        return {
          ...employee,
          successRateDelta: (lastEmployee?.operationSuccessRate || 0) - (firstEmployee?.operationSuccessRate || 0),
          achievementRateDelta: (lastEmployee?.achievementRate || 0) - (firstEmployee?.achievementRate || 0)
        };
      })
      .sort((left, right) => {
        if (right.improvedCount !== left.improvedCount) {
          return right.improvedCount - left.improvedCount;
        }

        return left.name.localeCompare(right.name, "tr");
      });

    return {
      improvedCount,
      employeeChanges
    };
  }

  const last7Window = aggregateFrontendWindow(7);
  const last30Window = aggregateFrontendWindow(30);

  return {
    snapshotCount: snapshots.length,
    latestSnapshotDate: latestSnapshot.date,
    previousSnapshotDate: previousSnapshot.date,
    last7DaysImprovedCount: last7Window.improvedCount,
    last30DaysImprovedCount: last30Window.improvedCount,
    last7DaysEmployeeChanges: last7Window.employeeChanges,
    last30DaysEmployeeChanges: last30Window.employeeChanges,
    summary: {
      latestDate: latestSnapshot.date,
      previousDate: previousSnapshot.date,
      employeeCount: latestSnapshot.employees.length,
      improvedOperationCount: operationChanges.filter((item) => item.scoreDelta > 0).length,
      regressedOperationCount: operationChanges.filter((item) => item.scoreDelta < 0).length,
      unchangedOperationCount: employeeChanges.reduce((sum, item) => sum + item.unchangedCount, 0)
    },
    employeeChanges,
    operationChanges,
    employeeTimeline: snapshots[0].employees
      .map((employee) => ({
        name: employee.name,
        mainDuty: employee.mainDuty,
        points: snapshots.map((snapshot) => {
          const snapshotEmployee = snapshot.employees.find((item) => item.name === employee.name);
          return {
            date: snapshot.date,
            successRate: snapshotEmployee?.operationSuccessRate || 0,
            achievementRate: snapshotEmployee?.achievementRate || 0,
            operations: snapshotEmployee?.operations || []
          };
        })
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "tr"))
  };
}

function renderGrowthChanges() {
  const container = document.getElementById("growthChanges");
  const report = state.growthReport;

  if ((report?.snapshotCount || 0) < 2) {
    container.innerHTML = `<p class="empty-state">Operasyon bazlı gelişim hareketleri için en az 2 günlük kayıt gereklidir.</p>`;
    return;
  }

  if (!report?.employeeTimeline?.length) {
    container.innerHTML = `<p class="empty-state">Karşılaştırılacak operasyon gelişim verisi bulunamadı.</p>`;
    return;
  }

  const availableDates = getGrowthChangeDateRange(report);

  if (!availableDates.length) {
    container.innerHTML = `<p class="empty-state">Operasyon gelişim tarihleri okunamadı.</p>`;
    return;
  }

  if (
    !["7d", "30d", "all", "custom"].includes(state.selectedGrowthChangesRange)
  ) {
    state.selectedGrowthChangesRange = "30d";
  }

  if (
    !state.selectedGrowthChangesCustomStart ||
    !availableDates.includes(state.selectedGrowthChangesCustomStart)
  ) {
    state.selectedGrowthChangesCustomStart = availableDates[0];
  }

  if (
    !state.selectedGrowthChangesCustomEnd ||
    !availableDates.includes(state.selectedGrowthChangesCustomEnd)
  ) {
    state.selectedGrowthChangesCustomEnd = availableDates[availableDates.length - 1];
  }

  if (state.selectedGrowthChangesCustomEnd < state.selectedGrowthChangesCustomStart) {
    state.selectedGrowthChangesCustomEnd = state.selectedGrowthChangesCustomStart;
  }

  const filteredDates = getFilteredGrowthChangeDates(report);

  if (filteredDates.length < 2) {
    container.innerHTML = `
      <div class="control-grid">
        <label class="control">
          <span>Zaman aralığı</span>
          <select id="growthChangesRangeSelect">
            <option value="7d">Son 1 Hafta</option>
            <option value="30d">Son 1 Ay</option>
            <option value="all">Tüm Kayıtlar</option>
            <option value="custom">Özel Tarih</option>
          </select>
        </label>
      </div>
      <p class="empty-state">Seçilen zaman aralığında operasyon gelişimi hesaplamak için en az 2 kayıt gereklidir.</p>
    `;

    const rangeSelect = document.getElementById("growthChangesRangeSelect");

    if (rangeSelect) {
      rangeSelect.value = state.selectedGrowthChangesRange;
      rangeSelect.onchange = () => {
        state.selectedGrowthChangesRange = rangeSelect.value;
        renderGrowthChanges();
      };
    }

    return;
  }

  const deviceOptions = [...new Set(
    report.employeeTimeline.flatMap((employee) => (
      employee.points.flatMap((point) => point.operations.map((operation) => operation.device))
    ))
  )].sort((left, right) => left.localeCompare(right, "tr"));

  const difficultyOptions = [...new Set(
    report.employeeTimeline.flatMap((employee) => (
      employee.points.flatMap((point) => point.operations.map((operation) => operation.difficulty).filter((value) => value))
    ))
  )].sort((left, right) => left - right);

  if (
    state.selectedGrowthChangesDevice !== "all" &&
    !deviceOptions.includes(state.selectedGrowthChangesDevice)
  ) {
    state.selectedGrowthChangesDevice = "all";
  }

  if (
    state.selectedGrowthChangesDifficulty !== "all" &&
    !difficultyOptions.map(String).includes(String(state.selectedGrowthChangesDifficulty))
  ) {
    state.selectedGrowthChangesDifficulty = "all";
  }

  const rows = buildOperationGrowthRows(report)
    .filter((row) => (
      (state.selectedGrowthChangesDevice === "all" || row.device === state.selectedGrowthChangesDevice) &&
      (
        state.selectedGrowthChangesDifficulty === "all" ||
        String(row.difficulty) === String(state.selectedGrowthChangesDifficulty)
      )
    ))
    .sort((left, right) => {
      if ((right.improvedPeopleRate || 0) !== (left.improvedPeopleRate || 0)) {
        return (right.improvedPeopleRate || 0) - (left.improvedPeopleRate || 0);
      }

      if ((right.improvedPeopleCount || 0) !== (left.improvedPeopleCount || 0)) {
        return (right.improvedPeopleCount || 0) - (left.improvedPeopleCount || 0);
      }

      if ((right.successRateDelta || 0) !== (left.successRateDelta || 0)) {
        return (right.successRateDelta || 0) - (left.successRateDelta || 0);
      }

      return left.operationName.localeCompare(right.operationName, "tr");
    });

  const rangeLabel = state.selectedGrowthChangesRange === "7d"
    ? "Son 1 Hafta"
    : state.selectedGrowthChangesRange === "30d"
      ? "Son 1 Ay"
      : state.selectedGrowthChangesRange === "all"
        ? "Tüm Kayıtlar"
        : "Özel Tarih";
  const filteredStart = filteredDates[0];
  const filteredEnd = filteredDates[filteredDates.length - 1];

  container.innerHTML = `
    <div class="section-title-row">
      <strong>${escapeHtml(rangeLabel)} İçin Operasyon Gelişim Özeti</strong>
      <span>${escapeHtml(filteredStart)} ile ${escapeHtml(filteredEnd)} arasındaki ilk ve son kayıt karşılaştırılmaktadır.</span>
    </div>
    <div class="control-grid">
      <label class="control">
        <span>Zaman aralığı</span>
        <select id="growthChangesRangeSelect">
          <option value="7d">Son 1 Hafta</option>
          <option value="30d">Son 1 Ay</option>
          <option value="all">Tüm Kayıtlar</option>
          <option value="custom">Özel Tarih</option>
        </select>
      </label>
      <label class="control">
        <span>Cihaz</span>
        <select id="growthChangesDeviceSelect">
          <option value="all">Tüm Cihazlar</option>
          ${deviceOptions.map((device) => `<option value="${escapeHtml(device)}">${escapeHtml(device)}</option>`).join("")}
        </select>
      </label>
      <label class="control">
        <span>Zorluk derecesi</span>
        <select id="growthChangesDifficultySelect">
          <option value="all">Tüm Dereceler</option>
          ${difficultyOptions.map((difficulty) => (
            `<option value="${difficulty}">${difficulty}. Derece</option>`
          )).join("")}
        </select>
      </label>
      ${state.selectedGrowthChangesRange === "custom" ? `
        <label class="control">
          <span>Başlangıç tarihi</span>
          <select id="growthChangesCustomStartSelect">
            ${availableDates.map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`).join("")}
          </select>
        </label>
        <label class="control">
          <span>Bitiş tarihi</span>
          <select id="growthChangesCustomEndSelect">
            ${availableDates
              .filter((date) => date >= state.selectedGrowthChangesCustomStart)
              .map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`)
              .join("")}
          </select>
        </label>
      ` : ""}
    </div>
    ${rows.length ? `
      <table class="detail-table">
        <thead>
          <tr>
            <th>Cihaz</th>
            <th>Operasyon</th>
            <th>Zorluk Derecesi</th>
            <th>Hedefi Olan Kişi Sayısı</th>
            <th>Gelişim Gösteren Kişi Sayısı</th>
            <th>Gelişim Gösteren Kişi Oranı</th>
            <th>Başarılı Kişi</th>
            <th>Başarı Oranı Artışı</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.device)}</td>
              <td>${escapeHtml(row.operationName)}</td>
              <td>${row.difficulty ? `${formatNumber(row.difficulty, 0)}. Derece` : "-"}</td>
              <td>${formatNumber(row.targetedPeopleCount, 0)}</td>
              <td>${formatNumber(row.improvedPeopleCount, 0)}</td>
              <td>${percent(row.improvedPeopleRate)}</td>
              <td>${formatNumber(row.firstSuccessfulCount, 0)} -> ${formatNumber(row.lastSuccessfulCount, 0)}</td>
              <td>${signedPercent(row.successRateDelta)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : `<p class="empty-state">Seçilen filtrelerde gelişim gösteren operasyon bulunamadı.</p>`}
  `;

  const rangeSelect = document.getElementById("growthChangesRangeSelect");
  const deviceSelect = document.getElementById("growthChangesDeviceSelect");
  const difficultySelect = document.getElementById("growthChangesDifficultySelect");
  const customStartSelect = document.getElementById("growthChangesCustomStartSelect");
  const customEndSelect = document.getElementById("growthChangesCustomEndSelect");

  if (rangeSelect) {
    rangeSelect.value = state.selectedGrowthChangesRange;
    rangeSelect.onchange = () => {
      state.selectedGrowthChangesRange = rangeSelect.value;
      renderGrowthChanges();
    };
  }

  if (deviceSelect) {
    deviceSelect.value = state.selectedGrowthChangesDevice;
    deviceSelect.onchange = () => {
      state.selectedGrowthChangesDevice = deviceSelect.value;
      renderGrowthChanges();
    };
  }

  if (difficultySelect) {
    difficultySelect.value = String(state.selectedGrowthChangesDifficulty);
    difficultySelect.onchange = () => {
      state.selectedGrowthChangesDifficulty = difficultySelect.value;
      renderGrowthChanges();
    };
  }

  if (customStartSelect) {
    customStartSelect.value = state.selectedGrowthChangesCustomStart;
    customStartSelect.onchange = () => {
      state.selectedGrowthChangesCustomStart = customStartSelect.value;

      if (state.selectedGrowthChangesCustomEnd < state.selectedGrowthChangesCustomStart) {
        state.selectedGrowthChangesCustomEnd = state.selectedGrowthChangesCustomStart;
      }

      renderGrowthChanges();
    };
  }

  if (customEndSelect) {
    customEndSelect.value = state.selectedGrowthChangesCustomEnd;
    customEndSelect.onchange = () => {
      state.selectedGrowthChangesCustomEnd = customEndSelect.value;

      if (state.selectedGrowthChangesCustomEnd < state.selectedGrowthChangesCustomStart) {
        state.selectedGrowthChangesCustomStart = state.selectedGrowthChangesCustomEnd;
      }

      renderGrowthChanges();
    };
  }
}

function renderEmployeeSelect() {
  const options = state.employees
    .map((employee) => `<option value="${escapeHtml(employee.name)}">${escapeHtml(employee.name)}</option>`)
    .join("");

  const employeeSelect = document.getElementById("employeeSelect");

  employeeSelect.innerHTML = options;
  employeeSelect.onchange = () => {
    state.expandedEmployeeFailuresFor = null;
    state.expandedEmployeeFailureDevices = {};
    renderEmployeeDetails(employeeSelect.value);
    renderEmployeeStrengths(employeeSelect.value);
  };

  renderEmployeeDetails(employeeSelect.value);
  renderEmployeeStrengths(employeeSelect.value);
}

function toggleEmployeeFailures(employeeName) {
  state.expandedEmployeeFailuresFor = state.expandedEmployeeFailuresFor === employeeName ? null : employeeName;
  renderEmployeeStrengths(employeeName);
}

function toggleEmployeeFailureDevice(employeeName, deviceName) {
  const key = `${employeeName}::${deviceName}`;
  state.expandedEmployeeFailureDevices[key] = !state.expandedEmployeeFailureDevices[key];
  renderEmployeeStrengths(employeeName);
}

function getFilteredOperationsForDetails() {
  return state.operations
    .filter((operation) => (
      state.selectedOperationDevice === "all" || operation.device === state.selectedOperationDevice
    ))
    .sort((left, right) => left.operationName.localeCompare(right.operationName, "tr"));
}

function renderOperationDeviceSelect() {
  const select = document.getElementById("operationDeviceSelect");
  const deviceOptions = [...new Set(state.operations.map((operation) => operation.device))]
    .sort((left, right) => left.localeCompare(right, "tr"));

  select.innerHTML = [
    `<option value="all">Tüm Cihazlar</option>`,
    ...deviceOptions.map((device) => `<option value="${escapeHtml(device)}">${escapeHtml(device)}</option>`)
  ].join("");

  select.value = state.selectedOperationDevice;
  select.onchange = () => {
    state.selectedOperationDevice = select.value;
    renderOperationSelect();
  };
}

function renderOperationSelect() {
  const select = document.getElementById("operationSelect");
  const operations = getFilteredOperationsForDetails();

  select.innerHTML = operations
    .map((operation) => `<option value="${escapeHtml(operation.operationName)}">${escapeHtml(operation.operationName)}</option>`)
    .join("");

  select.onchange = () => renderOperationDetails(select.value);

  if (!operations.length) {
    renderOperationDetails("");
    return;
  }

  renderOperationDetails(select.value || operations[0].operationName);
}

function renderDifficultyDeviceSelect() {
  const select = document.getElementById("difficultyDeviceSelect");
  const deviceOptions = [...new Set(state.operations.map((operation) => operation.device))]
    .sort((left, right) => left.localeCompare(right, "tr"));

  select.innerHTML = [
    `<option value="all">Tüm Cihazlar</option>`,
    ...deviceOptions.map((device) => `<option value="${escapeHtml(device)}">${escapeHtml(device)}</option>`)
  ].join("");

  select.value = state.selectedDifficultyDevice;
  select.onchange = () => {
    state.selectedDifficultyDevice = select.value;
    renderDifficultyCountChart();
  };
}

function renderEmployeeDetails(employeeName) {
  const employee = state.employees.find((item) => item.name === employeeName);
  const container = document.getElementById("employeeDetails");

  if (!employee) {
    container.textContent = "Personel bulunamadı.";
    return;
  }

  const derivedEmployee = deriveEmployeeMetrics(employee);
  const devicePerformance = [...derivedEmployee.operations]
    .filter((operation) => operation.targetScore !== null && operation.actualScore !== null)
    .reduce((grouped, operation) => {
      if (!grouped.has(operation.device)) {
        grouped.set(operation.device, {
          device: operation.device,
          targetTotal: 0,
          actualTotal: 0,
          successCount: 0,
          totalCount: 0
        });
      }

      const bucket = grouped.get(operation.device);
      bucket.targetTotal += operation.targetScore || 0;
      bucket.actualTotal += operation.actualScore || 0;
      bucket.totalCount += 1;

      if (operation.passed) {
        bucket.successCount += 1;
      }

      return grouped;
    }, new Map());

  const devicePerformanceRows = [...devicePerformance.values()]
    .map((item) => ({
      ...item,
      successRate: divideSafe(item.successCount, item.totalCount),
      achievementRate: divideSafe(item.actualTotal, item.targetTotal)
    }))
    .sort((left, right) => (right.successRate || 0) - (left.successRate || 0));

  container.innerHTML = `
    <div class="detail-hero">
      <div class="detail-hero-header">
        <strong>${escapeHtml(employee.name)}</strong>
        <span>Personelin görev ve performans görünümü</span>
      </div>
      <div class="detail-bubble-grid">
        <article class="detail-bubble">
          <label>Ana görev</label>
          <strong>${escapeHtml(employee.mainDuty || "-")}</strong>
        </article>
        <article class="detail-bubble">
          <label>Yan görev</label>
          <strong>${escapeHtml(employee.secondaryDuty || "-")}</strong>
        </article>
        <article class="detail-bubble">
          <label>Görev ünvanı</label>
          <strong>${escapeHtml(employee.jobTitle || "-")}</strong>
        </article>
        <article class="detail-bubble">
          <label>Yedek</label>
          <strong>${escapeHtml(employee.alternate || "-")}</strong>
        </article>
        <article class="detail-bubble">
          <label>Yetkilisi</label>
          <strong>${escapeHtml(employee.supervisor || "-")}</strong>
        </article>
      </div>
    </div>
    <div class="detail-bubble-grid detail-bubble-grid-metrics">
      <article class="detail-bubble detail-bubble-metric">
        <label>Toplam hedef puanı</label>
        <strong>${formatNumber(derivedEmployee.targetTotal)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Toplam gerçekleşen puanı</label>
        <strong>${formatNumber(derivedEmployee.actualTotal)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarı oranı</label>
        <strong>${percent(derivedEmployee.operationSuccessRate)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Hedef gerçekleşme</label>
        <strong>${percent(derivedEmployee.achievementRate)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarılı olunan operasyon sayısı</label>
        <strong>${formatNumber(derivedEmployee.successCount, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarısız olunan operasyon sayısı</label>
        <strong>${formatNumber(derivedEmployee.failureCount, 0)}</strong>
      </article>
    </div>
    <div class="section-title-row">
      <strong>Cihaz Bazında Operasyonel Başarı</strong>
      <span>Hedef beklenen puanı, Gerçekleşen ise alınan fiili puanı ifade eder.</span>
    </div>
    <div class="device-performance-list">
      ${devicePerformanceRows.length
        ? devicePerformanceRows.map((item) => `
            <article class="device-performance-card">
              <div class="device-performance-head">
                <strong>${escapeHtml(item.device)}</strong>
                <span>${formatNumber(item.totalCount, 0)} operasyon</span>
              </div>
              <div class="metric-row">
                <span>Operasyon başarısı: ${percent(item.successRate)}</span>
                <span>Hedef gerçekleşmesi: ${percent(item.achievementRate)}</span>
                <span>Başarılı operasyon: ${formatNumber(item.successCount, 0)}</span>
              </div>
            </article>
          `).join("")
        : `<p class="empty-state">Cihaz bazında gösterilecek veri bulunamadı.</p>`}
    </div>
  `;
}

function renderOperationDetails(operationName) {
  const operation = state.operations.find((item) => item.operationName === operationName);
  const container = document.getElementById("operationDetails");

  if (!operation) {
    container.textContent = "Seçili filtre için operasyon bulunamadı.";
    return;
  }

  const derivedOperation = deriveOperationMetrics(operation);

  const peopleRows = derivedOperation.people.map((person) => `
    <tr>
      <td>${escapeHtml(person.name)}</td>
      <td>${formatNumber(person.targetScore)}</td>
      <td>${formatNumber(person.actualScore)}</td>
      <td>${formatNumber(person.gap)}</td>
      <td><span class="pill ${person.passed ? "ok" : "bad"}">${person.passed ? "Başarılı" : "Başarısız"}</span></td>
    </tr>
  `).join("");

  container.innerHTML = `
    <div class="detail-hero">
      <div class="detail-hero-header">
        <strong>${escapeHtml(operation.operationName)}</strong>
        <span>Operasyonun cihaz, zorluk ve katılımcı performans görünümü</span>
      </div>
      <div class="detail-bubble-grid">
        <article class="detail-bubble">
          <label>Cihaz</label>
          <strong>${escapeHtml(operation.device)}</strong>
        </article>
        <article class="detail-bubble">
          <label>Stok kodu</label>
          <strong>${escapeHtml(operation.stockCode)}</strong>
        </article>
        <article class="detail-bubble">
          <label>Zorluk derecesi</label>
          <strong>${formatNumber(operation.difficulty, 0)}</strong>
        </article>
      </div>
    </div>
    <div class="detail-bubble-grid detail-bubble-grid-metrics">
      <article class="detail-bubble detail-bubble-metric">
        <label>Katılımcı</label>
        <strong>${formatNumber(derivedOperation.participantCount, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarı oranı</label>
        <strong>${percent(derivedOperation.operationSuccessRate)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Hedef gerçekleşme</label>
        <strong>${percent(derivedOperation.achievementRate)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarılı kişi</label>
        <strong>${formatNumber(derivedOperation.successCount, 0)}</strong>
      </article>
      <article class="detail-bubble detail-bubble-metric">
        <label>Başarısız kişi</label>
        <strong>${formatNumber(derivedOperation.failureCount, 0)}</strong>
      </article>
    </div>
    <div class="section-title-row">
      <strong>Katılımcı Puan Dağılımı</strong>
      <span>Hedef beklenen puanı, Gerçekleşen ise alınan fiili puanı ifade eder.</span>
    </div>
    <table class="detail-table">
      <thead>
        <tr>
          <th>Personel</th>
          <th>Hedef Puan</th>
          <th>Gerçekleşen Puan</th>
          <th>Fark</th>
          <th>Durum</th>
        </tr>
      </thead>
      <tbody>${peopleRows}</tbody>
    </table>
  `;
}

function renderBarRows(containerId, rows, formatter, extraInfo, actionsRenderer, detailRenderer) {
  const container = document.getElementById(containerId);

  if (!rows.length) {
    container.innerHTML = `<p class="empty-state">Gösterilecek veri bulunamadı.</p>`;
    return;
  }

  const maxValue = Math.max(...rows.map((row) => Math.abs(row.value)));

  container.innerHTML = `
    <div class="bar-chart">
      ${rows.map((row) => {
        const width = maxValue ? (Math.abs(row.value) / maxValue) * 100 : 0;
        return `
          <div class="bar-row">
            <div class="bar-meta">
              <strong>${escapeHtml(row.label)}</strong>
              <span>${formatter(row.value)}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${width}%"></div>
            </div>
            ${actionsRenderer ? `<div class="metric-row compact">${actionsRenderer(row)}</div>` : ""}
            ${extraInfo ? `<div class="metric-row compact">${extraInfo(row)}</div>` : ""}
            ${detailRenderer ? detailRenderer(row) : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function getDifficultyCounts() {
  const counts = new Map([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);

  state.operations
    .filter((operation) => (
      state.selectedDifficultyDevice === "all" ||
      operation.device === state.selectedDifficultyDevice
    ))
    .forEach((operation) => {
    const key = Number(operation.difficulty);
    if (counts.has(key)) {
      counts.set(key, counts.get(key) + 1);
    }
    });

  return [...counts.entries()].map(([difficulty, count]) => ({
    difficulty,
    label: `${difficulty}. Derece`,
    value: count
  }));
}

function filteredDifficultyOperations(difficulty) {
  return state.operations
    .filter((operation) => (
      Number(operation.difficulty) === Number(difficulty) &&
      (state.selectedDifficultyDevice === "all" || operation.device === state.selectedDifficultyDevice)
    ))
    .sort((left, right) => left.operationName.localeCompare(right.operationName, "tr"));
}

function toggleDifficultyOperations(difficulty) {
  state.expandedDifficultyDegree = state.expandedDifficultyDegree === difficulty ? null : difficulty;
  renderDifficultyCountChart();
}

function renderDifficultyOperationsViewer(row) {
  if (state.expandedDifficultyDegree !== row.difficulty) {
    return "";
  }

  const operations = filteredDifficultyOperations(row.difficulty);
  const deviceText = state.selectedDifficultyDevice === "all"
    ? "Tüm Cihazlar"
    : state.selectedDifficultyDevice;

  return `
    <div class="viewer-card inline-viewer">
      <div class="viewer-heading">
        <strong>${row.difficulty}. Derece Operasyonları</strong>
        <span>${deviceText} için ${formatNumber(operations.length, 0)} operasyon listeleniyor.</span>
      </div>
      <div class="viewer-list">
        ${operations.length
          ? operations.map((operation) => `
              <div class="viewer-item">
                <strong>${escapeHtml(operation.operationName)}</strong>
                <div class="metric-row compact">
                  <span>Cihaz: ${escapeHtml(operation.device)}</span>
                  <span>Stok Kodu: ${escapeHtml(operation.stockCode)}</span>
                  <span>Başarı Oranı: ${percent(deriveOperationMetrics(operation).operationSuccessRate)}</span>
                </div>
              </div>
            `).join("")
          : `<p class="empty-state">Seçilen derece için operasyon bulunamadı.</p>`}
      </div>
    </div>
  `;
}

function getDeviceDifficultyAverages() {
  const grouped = new Map();

  state.operations.forEach((operation) => {
    if (!grouped.has(operation.device)) {
      grouped.set(operation.device, {
        totalDifficulty: 0,
        count: 0
      });
    }

    const bucket = grouped.get(operation.device);
    bucket.totalDifficulty += operation.difficulty || 0;
    bucket.count += 1;
  });

  return [...grouped.entries()]
    .map(([device, values]) => ({
      label: device,
      value: values.count ? values.totalDifficulty / values.count : 0,
      count: values.count
    }))
    .sort((left, right) => right.value - left.value);
}

function renderDifficultyCountChart() {
  const rows = getDifficultyCounts();
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const deviceText = state.selectedDifficultyDevice === "all"
    ? "Tüm cihazlar"
    : `${state.selectedDifficultyDevice} cihazı`;

  document.getElementById("difficultyCountSummary").textContent =
    `${deviceText} için ${formatNumber(total, 0)} operasyonun zorluk derecelerine göre dağılımı gösterilmektedir.`;

  renderBarRows(
    "difficultyCountChart",
    rows,
    (value) => `${formatNumber(value, 0)} operasyon`,
    (row) => `<span>Toplam pay: ${percent(total ? row.value / total : 0)}</span>`,
    (row) => `
      <button
        class="mini-button"
        type="button"
        data-difficulty-toggle="${row.difficulty}"
      >
        ${state.expandedDifficultyDegree === row.difficulty ? "Operasyonları Gizle" : "Operasyonları Göster"}
      </button>
    `,
    (row) => renderDifficultyOperationsViewer(row)
  );

  containerBindDifficultyButtons();
}

function containerBindDifficultyButtons() {
  document
    .querySelectorAll("[data-difficulty-toggle]")
    .forEach((button) => {
      button.onclick = () => {
        toggleDifficultyOperations(Number(button.dataset.difficultyToggle));
      };
    });
}

function renderDeviceDifficultyChart() {
  const rows = getDeviceDifficultyAverages();
  const highest = rows[0];

  document.getElementById("deviceDifficultySummary").textContent = highest
    ? `${highest.label} cihazı ${formatNumber(highest.value)} ortalama zorluk ile en yüksek seviyede.`
    : "Cihaz verisi bulunamadı.";

  renderBarRows(
    "deviceDifficultyChart",
    rows,
    (value) => formatNumber(value),
    (row) => `<span>Operasyon sayısı: ${formatNumber(row.count, 0)}</span>`
  );
}

function renderEmployeeStrengths(employeeName) {
  const employee = state.employees.find((item) => item.name === employeeName);
  const container = document.getElementById("employeeStrengths");
  const summary = document.getElementById("employeeStrengthSummary");

  if (!employee) {
    container.textContent = "Personel bulunamadı.";
    summary.textContent = "Seçili personel için veri bulunamadı.";
    return;
  }

  const failedOperations = [...employee.operations]
    .map((operation) => ({
      ...operation,
      passed: isPassed(operation.actualScore)
    }))
    .filter((operation) => operation.actualScore !== null && !operation.passed)
    .sort((left, right) => {
      if ((left.gap || 0) !== (right.gap || 0)) {
        return (left.gap || 0) - (right.gap || 0);
      }

      return (left.actualScore || 0) - (right.actualScore || 0);
    });

  const groupedOperations = failedOperations.reduce((groups, operation) => {
    if (!groups.has(operation.device)) {
      groups.set(operation.device, []);
    }

    groups.get(operation.device).push(operation);
    return groups;
  }, new Map());
  summary.textContent =
    `${employee.name} için başarısız olduğu ${formatNumber(failedOperations.length, 0)} operasyon bulunuyor. Liste cihaz bazında gruplanmıştır.`;

  container.innerHTML = `
    <div class="device-performance-list">
      ${[...groupedOperations.entries()].map(([device, operations]) => {
        const key = `${employeeName}::${device}`;
        const isExpanded = Boolean(state.expandedEmployeeFailureDevices[key]);
        const visibleOperations = isExpanded ? operations : operations.slice(0, 10);
        const hasMore = operations.length > 10;

        return `
          <article class="device-performance-card">
            <div class="device-performance-head">
              <strong>${escapeHtml(device)}</strong>
              <span>${formatNumber(operations.length, 0)} başarısız operasyon</span>
            </div>
          <table class="detail-table">
            <thead>
              <tr>
                <th>Operasyon</th>
                <th>Zorluk</th>
                <th>Hedef Puan</th>
                <th>Gerçekleşen Puan</th>
                <th>Fark</th>
                <th>Durum</th>
              </tr>
              </thead>
              <tbody>
                ${visibleOperations.map((operation) => `
                  <tr>
                    <td>${escapeHtml(operation.operationName)}</td>
                    <td>${formatNumber(operation.difficulty, 0)}</td>
                    <td>${formatNumber(operation.targetScore)}</td>
                    <td>${formatNumber(operation.actualScore)}</td>
                    <td>${formatNumber(operation.gap)}</td>
                    <td><span class="pill ${operation.passed ? "ok" : "bad"}">${operation.passed ? "Başarılı" : "Başarısız"}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
            ${hasMore ? `
              <div class="metric-row">
                <button class="mini-button employee-device-toggle" type="button" data-employee-device-toggle="${escapeHtml(key)}">
                  ${isExpanded ? "Daha Az Göster" : "Tümünü Göster"}
                </button>
              </div>
            ` : ""}
          </article>
        `;
      }).join("")}
    </div>
  `;

  document.querySelectorAll("[data-employee-device-toggle]").forEach((button) => {
    button.onclick = () => {
      const [employeeKey, deviceKey] = button.dataset.employeeDeviceToggle.split("::");
      toggleEmployeeFailureDevice(employeeKey, deviceKey);
    };
  });
}

function renderFocusedCharts() {
  renderDifficultyCountChart();
  renderDeviceDifficultyChart();
}

async function loadDashboard() {
  setStatus("Dashboard verisi yükleniyor...");

  const [overview, employees, operations] = await Promise.all([
    fetchJsonOrThrow("/analytics/overview", { cache: "no-store" }),
    fetchJsonOrThrow("/analytics/employees", { cache: "no-store" }),
    fetchJsonOrThrow("/analytics/operations", { cache: "no-store" })
  ]);

  state.overview = overview;
  state.employees = employees;
  state.operations = operations;
  state.growthReport = overview.growthReport || null;

  renderSummary();
  renderRiskOperations();
  renderTopEmployees();
  renderEmployeeSelect();
  renderOperationDeviceSelect();
  renderOperationSelect();
  renderDifficultyDeviceSelect();
  renderFocusedCharts();
  await refreshGrowthDashboard();
  setStatus(`Son yükleme: ${new Date().toLocaleString("tr-TR")}`);
}


initializeViewTabs();

loadDashboard().catch((error) => {
  setStatus(`Veri yüklenemedi: ${error.message}`);
});

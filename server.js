const express = require("express");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const {
  DATA_DIR,
  STORAGE_DIR,
  WORKBOOK_PATH,
  PRODUCTS_FILE: DATA_FILE,
  PERSONNEL_GROWTH_FILE,
  SNAPSHOT_SCHEDULER_ENABLED
} = require("./config");
const { generateAiInsights } = require("./services/aiInsights");
const { loadWorkbookAnalytics, normalizePersonName } = require("./services/workbookAnalytics");
const {
  getLocalDateKey,
  getNextMidnightDelayMs,
  saveDailySnapshot,
  getGrowthReport,
  seedDemoHistory
} = require("./services/personnelGrowth");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 3000;

const app = express();

const defaultProducts = [
  { id: 1, name: "Laptop", price: 35000, inStock: true },
  { id: 2, name: "Mouse", price: 900, inStock: true }
];
let nextId = 3;
let products = [];
let workbookAnalytics = null;
let workbookLastModifiedMs = null;
let midnightRefreshTimer = null;

async function ensureDataFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    const initialData = {
      products: defaultProducts
    };

    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function loadProducts() {
  await ensureDataFile();

  const fileContent = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(fileContent);

  if (!parsed || !Array.isArray(parsed.products)) {
    throw new Error("products.json formati gecersiz");
  }

  products = parsed.products;
  nextId = products.reduce((maxId, product) => Math.max(maxId, product.id), 0) + 1;
}

async function saveProducts() {
  const payload = {
    products
  };

  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2));
}

function reloadWorkbookAnalytics() {
  const workbookStats = fsSync.statSync(WORKBOOK_PATH);
  workbookAnalytics = loadWorkbookAnalytics();
  workbookLastModifiedMs = workbookStats.mtimeMs;
  return workbookAnalytics;
}

async function saveTodayGrowthSnapshot() {
  if (!workbookAnalytics) {
    return null;
  }

  return saveDailySnapshot(PERSONNEL_GROWTH_FILE, workbookAnalytics, getLocalDateKey());
}

async function runMidnightRefresh() {
  reloadWorkbookAnalytics();
  return saveTodayGrowthSnapshot();
}

function scheduleMidnightRefresh() {
  if (!SNAPSHOT_SCHEDULER_ENABLED) {
    console.log("Dahili gunluk snapshot zamanlayicisi devre disi.");
    return;
  }

  if (midnightRefreshTimer) {
    clearTimeout(midnightRefreshTimer);
  }

  midnightRefreshTimer = setTimeout(async () => {
    try {
      const result = await runMidnightRefresh();
      if (result?.created) {
        console.log("Gunluk personel gelisimi snapshot kaydi tamamlandi.");
      } else {
        console.log("Bugun icin zaten personel gelisimi snapshot kaydi bulunuyor.");
      }
    } catch (error) {
      console.error("Gunluk snapshot kaydi basarisiz:", error.message);
    } finally {
      scheduleMidnightRefresh();
    }
  }, getNextMidnightDelayMs());
}

function ensureFreshWorkbookAnalytics() {
  const workbookStats = fsSync.statSync(WORKBOOK_PATH);

  if (!workbookAnalytics || workbookLastModifiedMs !== workbookStats.mtimeMs) {
    reloadWorkbookAnalytics();
  }
}

function validateProduct(body) {
  if (typeof body.name !== "string" || body.name.trim() === "") {
    return "name alani zorunludur";
  }

  if (typeof body.price !== "number" || Number.isNaN(body.price) || body.price < 0) {
    return "price alani sifirdan buyuk veya esit bir number olmalidir";
  }

  if (body.inStock !== undefined && typeof body.inStock !== "boolean") {
    return "inStock alani boolean olmalidir";
  }

  return null;
}

function findProductIndex(id) {
  return products.findIndex((product) => product.id === id);
}

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/analytics") || req.path.startsWith("/ai")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    ensureFreshWorkbookAnalytics();
  }

  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    workbookLoaded: Boolean(workbookAnalytics),
    workbookLoadedAt: workbookAnalytics?.loadedAt || null,
    workbookPath: WORKBOOK_PATH,
    productsPath: DATA_FILE,
    growthHistoryPath: PERSONNEL_GROWTH_FILE,
    storageDir: STORAGE_DIR,
    schedulerEnabled: SNAPSHOT_SCHEDULER_ENABLED
  });
});

app.get("/analytics/overview", async (req, res, next) => {
  try {
    const growthReport = await getGrowthReport(PERSONNEL_GROWTH_FILE);
    res.status(200).json({
      ...workbookAnalytics.overview,
      growthReport
    });
  } catch (error) {
    next(error);
  }
});

app.get("/analytics/employees", (req, res) => {
  res.status(200).json(workbookAnalytics.employees);
});

app.get("/analytics/employees/:name", (req, res) => {
  const requestedName = normalizePersonName(req.params.name);
  const employee = workbookAnalytics.employees.find((item) => item.name === requestedName);

  if (!employee) {
    res.status(404).json({ error: "Personel bulunamadi" });
    return;
  }

  res.status(200).json(employee);
});

app.get("/analytics/operations", (req, res) => {
  res.status(200).json(workbookAnalytics.operations);
});

app.get("/analytics/operations/:operationName", (req, res) => {
  const requestedOperation = String(req.params.operationName || "").trim().toLocaleUpperCase("tr");
  const operation = workbookAnalytics.operations.find(
    (item) => item.operationName.toLocaleUpperCase("tr") === requestedOperation
  );

  if (!operation) {
    res.status(404).json({ error: "Operasyon bulunamadi" });
    return;
  }

  res.status(200).json(operation);
});

app.post("/analytics/reload", (req, res) => {
  const analytics = reloadWorkbookAnalytics();
  res.status(200).json({
    message: "Excel verisi yeniden yuklendi",
    loadedAt: analytics.loadedAt,
    workbookPath: analytics.workbookPath
  });
});

async function handlePersonnelGrowthReport(req, res, next) {
  try {
    const report = await getGrowthReport(PERSONNEL_GROWTH_FILE);
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
}

app.get("/analytics/personnel-growth", handlePersonnelGrowthReport);
app.get("/api/analytics/personnel-growth", handlePersonnelGrowthReport);
app.get("/api/personnel-growth", handlePersonnelGrowthReport);
app.get("/personnel-growth", handlePersonnelGrowthReport);

app.post("/analytics/personnel-growth/snapshot", async (req, res, next) => {
  try {
    const result = await saveTodayGrowthSnapshot();
    res.status(200).json({
      message: result?.created
        ? "Gunluk personel gelisimi snapshot kaydi olusturuldu"
        : "Bugun icin zaten personel gelisimi snapshot kaydi bulunuyor",
      created: Boolean(result?.created),
      snapshot: result?.snapshot || null
    });
  } catch (error) {
    next(error);
  }
});

app.post("/analytics/personnel-growth/demo-seed", async (req, res, next) => {
  try {
    const snapshots = await seedDemoHistory(PERSONNEL_GROWTH_FILE, workbookAnalytics, 5);
    res.status(200).json({
      message: "Demo personel gelisimi verileri olusturuldu",
      snapshotCount: snapshots.length
    });
  } catch (error) {
    next(error);
  }
});

app.post("/ai/analyze", async (req, res, next) => {
  try {
    const question = String(req.body?.question || "").trim();

    if (!question) {
      res.status(400).json({ error: "question alani zorunludur" });
      return;
    }

    const result = await generateAiInsights(question, workbookAnalytics);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/products", (req, res) => {
  res.status(200).json(products);
});

app.post("/products", async (req, res, next) => {
  const validationError = validateProduct(req.body);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const newProduct = {
    id: nextId++,
    name: req.body.name.trim(),
    price: req.body.price,
    inStock: req.body.inStock ?? true
  };

  try {
    products.push(newProduct);
    await saveProducts();
    res.status(201).json(newProduct);
  } catch (error) {
    next(error);
  }
});

app.get("/products/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Gecersiz product id" });
    return;
  }

  const index = findProductIndex(id);

  if (index === -1) {
    res.status(404).json({ error: "Product bulunamadi" });
    return;
  }

  res.status(200).json(products[index]);
});

app.put("/products/:id", async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Gecersiz product id" });
    return;
  }

  const index = findProductIndex(id);

  if (index === -1) {
    res.status(404).json({ error: "Product bulunamadi" });
    return;
  }

  const validationError = validateProduct(req.body);

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const updatedProduct = {
    id,
    name: req.body.name.trim(),
    price: req.body.price,
    inStock: req.body.inStock ?? products[index].inStock
  };

  try {
    products[index] = updatedProduct;
    await saveProducts();
    res.status(200).json(updatedProduct);
  } catch (error) {
    next(error);
  }
});

app.delete("/products/:id", async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Gecersiz product id" });
    return;
  }

  const index = findProductIndex(id);

  if (index === -1) {
    res.status(404).json({ error: "Product bulunamadi" });
    return;
  }

  try {
    const deletedProduct = products[index];
    products = products.filter((product) => product.id !== id);
    await saveProducts();
    res.status(200).json(deletedProduct);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Gecersiz JSON body" });
    return;
  }

  const statusCode = errorStatusCode(err);
  res.status(statusCode).json({
    error: err.message || "Beklenmeyen bir hata olustu",
    details: err.details || null
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route bulunamadi" });
});

function errorStatusCode(err) {
  if (typeof err?.statusCode === "number") {
    return err.statusCode;
  }

  return 500;
}

loadProducts()
  .then(async () => {
    reloadWorkbookAnalytics();
    scheduleMidnightRefresh();
    app.listen(PORT, HOST, () => {
      console.log(`Server http://${HOST}:${PORT} adresinde calisiyor`);
    });
  })
  .catch((error) => {
    console.error("Sunucu baslatilamadi:", error.message);
    process.exit(1);
  });

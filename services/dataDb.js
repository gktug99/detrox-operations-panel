const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function openDb(dbPath) {
  ensureDirForFile(dbPath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personnel (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      main_duty TEXT NOT NULL,
      secondary_duty TEXT NOT NULL,
      supervisor TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY,
      sequence INTEGER NOT NULL,
      device TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device, operation_name)
    );

    CREATE INDEX IF NOT EXISTS idx_operations_device ON operations(device);
    CREATE INDEX IF NOT EXISTS idx_operations_sequence ON operations(sequence);

    CREATE TABLE IF NOT EXISTS operation_scores (
      operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
      target_score INTEGER NULL CHECK (target_score BETWEEN 1 AND 5),
      actual_score INTEGER NULL CHECK (actual_score BETWEEN 1 AND 5),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(operation_id, personnel_id)
    );
  `);
}

function requireNonEmptyText(value, fieldName) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${fieldName} alani zorunludur`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!/^\d+$/u.test(trimmed)) {
      const error = new Error("Puanlar tam sayi olmalidir (1-5) veya bos birakilabilir");
      error.statusCode = 400;
      throw error;
    }
    value = Number(trimmed);
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    const error = new Error("Puanlar 1-5 araliginda tam sayi olmalidir veya bos birakilabilir");
    error.statusCode = 400;
    throw error;
  }

  return value;
}

function listPersonnel(db) {
  return db.prepare("SELECT id, name, main_duty, secondary_duty, supervisor FROM personnel ORDER BY name").all();
}

function createPersonnel(db, payload) {
  const name = requireNonEmptyText(payload?.name, "name");
  const mainDuty = requireNonEmptyText(payload?.mainDuty, "mainDuty");
  const secondaryDuty = requireNonEmptyText(payload?.secondaryDuty, "secondaryDuty");
  const supervisor = requireNonEmptyText(payload?.supervisor, "supervisor");

  const result = db
    .prepare(
      `
        INSERT INTO personnel (name, main_duty, secondary_duty, supervisor, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `
    )
    .run(name, mainDuty, secondaryDuty, supervisor);

  return db
    .prepare("SELECT id, name, main_duty, secondary_duty, supervisor FROM personnel WHERE id = ?")
    .get(result.lastInsertRowid);
}

function updatePersonnel(db, id, payload) {
  if (!Number.isInteger(id)) {
    const error = new Error("Gecersiz personnel id");
    error.statusCode = 400;
    throw error;
  }

  const existing = db.prepare("SELECT id FROM personnel WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("Personel bulunamadi");
    error.statusCode = 404;
    throw error;
  }

  const name = requireNonEmptyText(payload?.name, "name");
  const mainDuty = requireNonEmptyText(payload?.mainDuty, "mainDuty");
  const secondaryDuty = requireNonEmptyText(payload?.secondaryDuty, "secondaryDuty");
  const supervisor = requireNonEmptyText(payload?.supervisor, "supervisor");

  db.prepare(
    `
      UPDATE personnel
      SET name = ?, main_duty = ?, secondary_duty = ?, supervisor = ?, updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(name, mainDuty, secondaryDuty, supervisor, id);

  return db
    .prepare("SELECT id, name, main_duty, secondary_duty, supervisor FROM personnel WHERE id = ?")
    .get(id);
}

function deletePersonnel(db, id) {
  if (!Number.isInteger(id)) {
    const error = new Error("Gecersiz personnel id");
    error.statusCode = 400;
    throw error;
  }

  const existing = db
    .prepare("SELECT id, name, main_duty, secondary_duty, supervisor FROM personnel WHERE id = ?")
    .get(id);

  if (!existing) {
    const error = new Error("Personel bulunamadi");
    error.statusCode = 404;
    throw error;
  }

  db.prepare("DELETE FROM personnel WHERE id = ?").run(id);
  return existing;
}

function listOperations(db) {
  return db
    .prepare(
      `
        SELECT id, sequence, device, stock_code, operation_name, difficulty
        FROM operations
        ORDER BY sequence ASC
      `
    )
    .all();
}

function nextOperationSequence(db) {
  const row = db.prepare("SELECT MAX(sequence) AS max_seq FROM operations").get();
  return Number(row?.max_seq || 0) + 1;
}

function createOperation(db, payload) {
  const device = requireNonEmptyText(payload?.device, "device");
  const stockCode = requireNonEmptyText(payload?.stockCode, "stockCode");
  const operationName = requireNonEmptyText(payload?.operationName, "operationName");

  const difficulty = normalizeScore(payload?.difficulty);
  if (difficulty === null) {
    const error = new Error("difficulty alani zorunludur");
    error.statusCode = 400;
    throw error;
  }

  const sequence = nextOperationSequence(db);

  const result = db
    .prepare(
      `
        INSERT INTO operations (sequence, device, stock_code, operation_name, difficulty, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `
    )
    .run(sequence, device, stockCode, operationName, difficulty);

  return db
    .prepare(
      "SELECT id, sequence, device, stock_code, operation_name, difficulty FROM operations WHERE id = ?"
    )
    .get(result.lastInsertRowid);
}

function updateOperation(db, id, payload) {
  if (!Number.isInteger(id)) {
    const error = new Error("Gecersiz operation id");
    error.statusCode = 400;
    throw error;
  }

  const existing = db.prepare("SELECT id FROM operations WHERE id = ?").get(id);
  if (!existing) {
    const error = new Error("Operasyon bulunamadi");
    error.statusCode = 404;
    throw error;
  }

  const device = requireNonEmptyText(payload?.device, "device");
  const stockCode = requireNonEmptyText(payload?.stockCode, "stockCode");
  const operationName = requireNonEmptyText(payload?.operationName, "operationName");

  const difficulty = normalizeScore(payload?.difficulty);
  if (difficulty === null) {
    const error = new Error("difficulty alani zorunludur");
    error.statusCode = 400;
    throw error;
  }

  db.prepare(
    `
      UPDATE operations
      SET device = ?, stock_code = ?, operation_name = ?, difficulty = ?, updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(device, stockCode, operationName, difficulty, id);

  return db
    .prepare("SELECT id, sequence, device, stock_code, operation_name, difficulty FROM operations WHERE id = ?")
    .get(id);
}

function deleteOperation(db, id) {
  if (!Number.isInteger(id)) {
    const error = new Error("Gecersiz operation id");
    error.statusCode = 400;
    throw error;
  }

  const existing = db
    .prepare("SELECT id, sequence, device, stock_code, operation_name, difficulty FROM operations WHERE id = ?")
    .get(id);

  if (!existing) {
    const error = new Error("Operasyon bulunamadi");
    error.statusCode = 404;
    throw error;
  }

  db.prepare("DELETE FROM operations WHERE id = ?").run(id);
  return existing;
}

function listOperationScores(db, operationId) {
  if (!Number.isInteger(operationId)) {
    const error = new Error("Gecersiz operation id");
    error.statusCode = 400;
    throw error;
  }

  const operation = db
    .prepare("SELECT id, sequence, device, stock_code, operation_name, difficulty FROM operations WHERE id = ?")
    .get(operationId);

  if (!operation) {
    const error = new Error("Operasyon bulunamadi");
    error.statusCode = 404;
    throw error;
  }

  const rows = db
    .prepare(
      `
        SELECT
          p.id AS personnelId,
          p.name AS name,
          os.target_score AS targetScore,
          os.actual_score AS actualScore
        FROM personnel p
        LEFT JOIN operation_scores os
          ON os.personnel_id = p.id AND os.operation_id = ?
        ORDER BY p.name
      `
    )
    .all(operationId);

  return { operation, rows };
}

function setOperationScores(db, operationId, updates) {
  if (!Number.isInteger(operationId)) {
    const error = new Error("Gecersiz operation id");
    error.statusCode = 400;
    throw error;
  }

  const operation = db.prepare("SELECT id FROM operations WHERE id = ?").get(operationId);
  if (!operation) {
    const error = new Error("Operasyon bulunamadi");
    error.statusCode = 404;
    throw error;
  }

  if (!Array.isArray(updates)) {
    const error = new Error("updates alani dizi olmalidir");
    error.statusCode = 400;
    throw error;
  }

  const upsertStmt = db.prepare(
    `
      INSERT INTO operation_scores (operation_id, personnel_id, target_score, actual_score, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(operation_id, personnel_id) DO UPDATE SET
        target_score = excluded.target_score,
        actual_score = excluded.actual_score,
        updated_at = datetime('now')
    `
  );

  const deleteStmt = db.prepare(
    "DELETE FROM operation_scores WHERE operation_id = ? AND personnel_id = ?"
  );

  const transaction = db.transaction((items) => {
    items.forEach((item) => {
      const personnelId = Number(item?.personnelId);
      if (!Number.isInteger(personnelId)) {
        const error = new Error("personnelId gecersiz");
        error.statusCode = 400;
        throw error;
      }

      const targetScore = normalizeScore(item?.targetScore);
      const actualScore = normalizeScore(item?.actualScore);

      if (targetScore === null && actualScore === null) {
        deleteStmt.run(operationId, personnelId);
        return;
      }

      upsertStmt.run(operationId, personnelId, targetScore, actualScore);
    });
  });

  transaction(updates);
  return true;
}

module.exports = {
  openDb,
  listPersonnel,
  createPersonnel,
  updatePersonnel,
  deletePersonnel,
  listOperations,
  createOperation,
  updateOperation,
  deleteOperation,
  listOperationScores,
  setOperationScores
};


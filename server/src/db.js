require("dotenv").config();

const { Pool } = require("pg");
const crypto = require("crypto");

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

const connectionString = readEnv("DATABASE_URL");
const pgSslMode = readEnv("PGSSLMODE");
const pgPassword = readEnv("PGPASSWORD");

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl:
        pgSslMode === "disable"
          ? false
          : { rejectUnauthorized: false },
      family: 4
    })
  : new Pool({
      host: readEnv("PGHOST") || "localhost",
      port: Number(readEnv("PGPORT") || 5432),
      database: readEnv("PGDATABASE") || "tuition_fees",
      user: readEnv("PGUSER") || "postgres",
      password: pgPassword,
      family: 4
    });

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      batch_year TEXT NOT NULL,
      phone_number TEXT NOT NULL DEFAULT '',
      join_date TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS fee_records (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      month_number INTEGER NOT NULL,
      paid BOOLEAN NOT NULL DEFAULT FALSE,
      paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
      paid_date TEXT,
      UNIQUE(student_id, month_number)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      current_year_fee TEXT NOT NULL DEFAULT ''
    );
  `);

  const defaultAdminUsername = "admin";
  const defaultAdminPasswordHash = crypto.createHash("sha256").update("admin123").digest("hex");

  await query(
    `INSERT INTO admin_settings (id, username, password_hash, current_year_fee)
     VALUES (1, $1, $2, '')
     ON CONFLICT (id) DO NOTHING`,
    [defaultAdminUsername, defaultAdminPasswordHash]
  );
}

module.exports = {
  pool,
  query,
  withTransaction,
  initDb
};

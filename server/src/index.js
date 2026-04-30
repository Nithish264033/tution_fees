const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;
const clientDistPath = path.join(__dirname, "..", "..", "client", "dist");

app.use(cors());
app.use(express.json());

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const CURRENT_YEAR = new Date().getFullYear();

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function parseAmount(value) {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : 0;
}

function normalizeFeeRecord(fee, tuitionFee) {
  const paidAmount = Math.min(parseAmount(fee.paidAmount), tuitionFee);
  const remainingAmount = Number(Math.max(tuitionFee - paidAmount, 0).toFixed(2));

  return {
    monthNumber: fee.monthNumber,
    paid: remainingAmount === 0,
    paidAmount,
    remainingAmount,
    paidDate: paidAmount > 0 ? fee.paidDate || "" : ""
  };
}

function getAdminSettings() {
  return db
    .query(
      `SELECT username, password_hash AS "passwordHash", current_year_fee AS "currentYearFee"
       FROM admin_settings
       WHERE id = 1`
    )
    .then((result) => result.rows[0] || null);
}

async function loadStudentFees(studentId, tuitionFee, client = db) {
  return client
    .query(
      `SELECT month_number AS "monthNumber", paid, paid_amount AS "paidAmount", paid_date AS "paidDate"
       FROM fee_records
       WHERE student_id = $1
       ORDER BY month_number ASC`,
      [studentId]
    )
    .then((result) => result.rows.map((fee) => normalizeFeeRecord(fee, tuitionFee)));
}

async function hydrateStudent(row, client = db) {
  if (!row) {
    return null;
  }

  const adminSettings = await getAdminSettings();
  const tuitionFee = parseAmount(adminSettings?.currentYearFee);
  const fees = await loadStudentFees(row.id, tuitionFee, client);

  const feeMap = new Map(fees.map((fee) => [fee.monthNumber, fee]));

  return {
    id: row.id,
    name: row.name,
    className: row.class_name,
    batchYear: row.batch_year,
    phoneNumber: row.phone_number || "",
    joinDate: row.join_date || "",
    createdAt: row.created_at,
    tuitionFee,
    fees: MONTHS.map((monthNumber) => {
      const fee = feeMap.get(monthNumber);
      return {
        monthNumber,
        paid: fee ? fee.paid : tuitionFee === 0,
        paidAmount: fee ? fee.paidAmount : 0,
        remainingAmount: fee ? fee.remainingAmount : tuitionFee,
        paidDate: fee ? fee.paidDate : ""
      };
    })
  };
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.post("/api/login", asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const adminSettings = await getAdminSettings();

  if (
    adminSettings &&
    username === adminSettings.username &&
    hashPassword(password) === adminSettings.passwordHash
  ) {
    return res.json({
      success: true,
      user: {
        username: adminSettings.username,
        name: "Administrator"
      }
    });
  }

  return res.status(401).json({
    success: false,
    message: "Invalid username or password"
  });
}));

app.post("/api/admin/access", asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const adminSettings = await getAdminSettings();

  if (
    !adminSettings ||
    username !== adminSettings.username ||
    hashPassword(password) !== adminSettings.passwordHash
  ) {
    return res.status(401).json({ message: "Invalid admin username or password" });
  }

  return res.json({
    success: true,
    currentYear: CURRENT_YEAR,
    currentYearFee: adminSettings.currentYearFee || ""
  });
}));

app.get("/api/admin/settings", asyncHandler(async (_req, res) => {
  const adminSettings = await getAdminSettings();

  return res.json({
    currentYear: CURRENT_YEAR,
    currentYearFee: adminSettings ? adminSettings.currentYearFee || "" : ""
  });
}));

app.put("/api/admin/settings", asyncHandler(async (req, res) => {
  const {
    currentUsername,
    currentPassword,
    nextUsername,
    nextPassword,
    confirmPassword,
    currentYearFee
  } = req.body;

  const adminSettings = await getAdminSettings();

  if (
    !adminSettings ||
    currentUsername !== adminSettings.username ||
    hashPassword(currentPassword) !== adminSettings.passwordHash
  ) {
    return res.status(401).json({ message: "Current admin username or password is incorrect" });
  }

  if (!String(currentYearFee || "").trim()) {
    return res.status(400).json({ message: `Current year (${CURRENT_YEAR}) tuition fee is required` });
  }

  const wantsCredentialChange =
    Boolean(String(nextUsername || "").trim()) ||
    Boolean(String(nextPassword || "").trim()) ||
    Boolean(String(confirmPassword || "").trim());

  if (wantsCredentialChange) {
    if (!nextUsername || !nextPassword || !confirmPassword) {
      return res
        .status(400)
        .json({ message: "To change login, fill new username, new password, and confirm password" });
    }

    if (nextPassword !== confirmPassword) {
      return res.status(400).json({ message: "New password and confirm password must match" });
    }
  }

  const updatedUsername = wantsCredentialChange
    ? String(nextUsername).trim()
    : adminSettings.username;
  const updatedPasswordHash = wantsCredentialChange
    ? hashPassword(nextPassword)
    : adminSettings.passwordHash;

  await db.query(
    `UPDATE admin_settings
     SET username = $1, password_hash = $2, current_year_fee = $3
     WHERE id = 1`,
    [updatedUsername, updatedPasswordHash, String(currentYearFee).trim()]
  );

  return res.json({
    success: true,
    currentYear: CURRENT_YEAR,
    currentYearFee: String(currentYearFee).trim()
  });
}));

app.get("/api/options", asyncHandler(async (_req, res) => {
  const batchYears = await db
    .query('SELECT DISTINCT batch_year AS value FROM students ORDER BY batch_year DESC')
    .then((result) => result.rows.map((item) => item.value));

  const classes = await db
    .query('SELECT DISTINCT class_name AS value FROM students ORDER BY class_name ASC')
    .then((result) => result.rows.map((item) => item.value));

  res.json({ batchYears, classes });
}));

app.get("/api/students", asyncHandler(async (req, res) => {
  const { batchYear, className, status, search, monthNumber } = req.query;
  const normalizedSearch = String(search || "").trim();
  const selectedMonth = Number.parseInt(monthNumber, 10);

  const rows = await db
    .query(
      `SELECT id, name, class_name, batch_year, join_date, created_at
              , phone_number
       FROM students
       WHERE ($1::text = '' OR batch_year = $1)
         AND ($2::text = '' OR class_name = $2)
         AND ($3::text = '' OR LOWER(name) LIKE LOWER($4))
       ORDER BY name ASC`,
      [
        batchYear || "",
        className || "",
        normalizedSearch,
        `%${normalizedSearch}%`
      ]
    )
    .then((result) => result.rows);

  let students = await Promise.all(rows.map(hydrateStudent));

  if (status === "completed") {
    if (Number.isInteger(selectedMonth) && selectedMonth >= 1 && selectedMonth <= 12) {
      students = students.filter((student) =>
        student.fees.some((fee) => fee.monthNumber === selectedMonth && fee.remainingAmount === 0)
      );
    } else {
      students = students.filter((student) => student.fees.every((fee) => fee.remainingAmount === 0));
    }
  }

  if (status === "pending") {
    if (Number.isInteger(selectedMonth) && selectedMonth >= 1 && selectedMonth <= 12) {
      students = students.filter((student) =>
        student.fees.some((fee) => fee.monthNumber === selectedMonth && fee.remainingAmount > 0)
      );
    } else {
      students = students.filter((student) => student.fees.some((fee) => fee.remainingAmount > 0));
    }
  }

  res.json(students);
}));

app.get("/api/students/:id", asyncHandler(async (req, res) => {
  const row = await db
    .query(
      `SELECT id, name, class_name, batch_year, join_date, created_at
              , phone_number
       FROM students
       WHERE id = $1`,
      [req.params.id]
    )
    .then((result) => result.rows[0] || null);

  const student = await hydrateStudent(row);

  if (!student) {
    return res.status(404).json({ message: "Student not found" });
  }

  return res.json(student);
}));

app.post("/api/students", asyncHandler(async (req, res) => {
  const { name, className, batchYear, phoneNumber, joinDate } = req.body;

  if (!name || !className || !batchYear || !phoneNumber || !joinDate) {
    return res
      .status(400)
      .json({ message: "Name, class, batch year, phone number, and join date are required" });
  }

  const student = await db.withTransaction(async (client) => {
    const insertResult = await client.query(
      `INSERT INTO students (name, class_name, batch_year, phone_number, join_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, class_name, batch_year, phone_number, join_date, created_at`,
      [
        name.trim(),
        className.trim(),
        String(batchYear).trim(),
        String(phoneNumber).trim(),
        joinDate
      ]
    );

    for (const monthNumber of MONTHS) {
      await client.query(
        `INSERT INTO fee_records (student_id, month_number, paid, paid_amount, paid_date)
         VALUES ($1, $2, FALSE, 0, NULL)
         ON CONFLICT (student_id, month_number) DO NOTHING`,
        [insertResult.rows[0].id, monthNumber]
      );
    }

    return hydrateStudent(insertResult.rows[0], client);
  });

  return res.status(201).json(student);
}));

app.put("/api/students/:id", asyncHandler(async (req, res) => {
  const { name, className, batchYear, phoneNumber, joinDate } = req.body;

  if (!name || !className || !batchYear || !phoneNumber || !joinDate) {
    return res
      .status(400)
      .json({ message: "Name, class, batch year, phone number, and join date are required" });
  }

  const result = await db
    .query(
      `UPDATE students
       SET name = $1, class_name = $2, batch_year = $3, phone_number = $4, join_date = $5
       WHERE id = $6
       RETURNING id, name, class_name, batch_year, phone_number, join_date, created_at`,
      [
        name.trim(),
        className.trim(),
        String(batchYear).trim(),
        String(phoneNumber).trim(),
        joinDate,
        req.params.id
      ]
    )
    .then((queryResult) => queryResult.rows[0] || null);

  if (!result) {
    return res.status(404).json({ message: "Student not found" });
  }

  const student = await hydrateStudent(result);

  return res.json(student);
}));

app.delete("/api/students/:id", asyncHandler(async (req, res) => {
  const result = await db
    .query(
      `DELETE FROM students
       WHERE id = $1`,
      [req.params.id]
    )
    .then((queryResult) => queryResult.rowCount);

  if (result === 0) {
    return res.status(404).json({ message: "Student not found" });
  }

  return res.json({ success: true });
}));

app.put("/api/students/:id/fees", asyncHandler(async (req, res) => {
  const { fees } = req.body;

  if (!Array.isArray(fees) || fees.length !== 12) {
    return res.status(400).json({ message: "All 12 month fee records are required" });
  }

  const studentRow = await db
    .query(
      `SELECT id, name, class_name, batch_year, phone_number, join_date, created_at
       FROM students
       WHERE id = $1`,
      [req.params.id]
    )
    .then((result) => result.rows[0] || null);

  if (!studentRow) {
    return res.status(404).json({ message: "Student not found" });
  }

  const adminSettings = await getAdminSettings();
  const tuitionFee = parseAmount(adminSettings?.currentYearFee);

  await db.withTransaction(async (client) => {
    for (const fee of fees) {
      const paidAmount = Math.min(parseAmount(fee.paidAmount), tuitionFee);
      const remainingAmount = Number(Math.max(tuitionFee - paidAmount, 0).toFixed(2));

      await client.query(
        `INSERT INTO fee_records (student_id, month_number, paid, paid_amount, paid_date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(student_id, month_number)
         DO UPDATE SET
           paid = EXCLUDED.paid,
           paid_amount = EXCLUDED.paid_amount,
           paid_date = EXCLUDED.paid_date`,
        [
          req.params.id,
          fee.monthNumber,
          remainingAmount === 0,
          paidAmount,
          paidAmount > 0 ? fee.paidDate || null : null
        ]
      );
    }
  });

  const student = await hydrateStudent(studentRow);

  return res.json(student);
}));

app.use(express.static(clientDistPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Internal server error" });
});

db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });

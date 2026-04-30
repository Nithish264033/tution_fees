const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const { Student, FeeRecord, AdminSettings, getNextId, initDb } = require("./db");

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
  const paidAmount = Math.min(parseAmount(fee.paid_amount), tuitionFee);
  const remainingAmount = Number(Math.max(tuitionFee - paidAmount, 0).toFixed(2));
  return {
    monthNumber: fee.month_number,
    paid: remainingAmount === 0,
    paidAmount,
    remainingAmount,
    paidDate: paidAmount > 0 ? fee.paid_date || "" : ""
  };
}

async function getAdminSettings() {
  const doc = await AdminSettings.findById(1).lean();
  if (!doc) return null;
  return {
    username: doc.username,
    passwordHash: doc.password_hash,
    currentYearFee: doc.current_year_fee
  };
}

async function loadStudentFees(studentId, tuitionFee) {
  const fees = await FeeRecord.find({ student_id: studentId }).sort({ month_number: 1 }).lean();
  return fees.map((fee) => normalizeFeeRecord(fee, tuitionFee));
}

async function hydrateStudent(row) {
  if (!row) return null;

  const adminSettings = await getAdminSettings();
  const tuitionFee = parseAmount(adminSettings?.currentYearFee);
  const fees = await loadStudentFees(row._id, tuitionFee);
  const feeMap = new Map(fees.map((fee) => [fee.monthNumber, fee]));

  return {
    id: row._id,
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
    return res.json({ success: true, user: { username: adminSettings.username, name: "Administrator" } });
  }

  return res.status(401).json({ success: false, message: "Invalid username or password" });
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

  return res.json({ success: true, currentYear: CURRENT_YEAR, currentYearFee: adminSettings.currentYearFee || "" });
}));

app.get("/api/admin/settings", asyncHandler(async (_req, res) => {
  const adminSettings = await getAdminSettings();
  return res.json({
    currentYear: CURRENT_YEAR,
    currentYearFee: adminSettings ? adminSettings.currentYearFee || "" : ""
  });
}));

app.put("/api/admin/settings", asyncHandler(async (req, res) => {
  const { currentUsername, currentPassword, nextUsername, nextPassword, confirmPassword, currentYearFee } = req.body;
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
      return res.status(400).json({ message: "To change login, fill new username, new password, and confirm password" });
    }
    if (nextPassword !== confirmPassword) {
      return res.status(400).json({ message: "New password and confirm password must match" });
    }
  }

  const updatedUsername = wantsCredentialChange ? String(nextUsername).trim() : adminSettings.username;
  const updatedPasswordHash = wantsCredentialChange ? hashPassword(nextPassword) : adminSettings.passwordHash;

  await AdminSettings.findByIdAndUpdate(1, {
    username: updatedUsername,
    password_hash: updatedPasswordHash,
    current_year_fee: String(currentYearFee).trim()
  });

  return res.json({ success: true, currentYear: CURRENT_YEAR, currentYearFee: String(currentYearFee).trim() });
}));

app.get("/api/options", asyncHandler(async (_req, res) => {
  const batchYears = await Student.distinct("batch_year").then((r) => r.sort((a, b) => b.localeCompare(a)));
  const classes = await Student.distinct("class_name").then((r) => r.sort());
  res.json({ batchYears, classes });
}));

app.get("/api/students", asyncHandler(async (req, res) => {
  const { batchYear, className, status, search, monthNumber } = req.query;
  const normalizedSearch = String(search || "").trim();
  const selectedMonth = Number.parseInt(monthNumber, 10);

  const filter = {};
  if (batchYear) filter.batch_year = batchYear;
  if (className) filter.class_name = className;
  if (normalizedSearch) filter.name = { $regex: normalizedSearch, $options: "i" };

  const rows = await Student.find(filter).sort({ name: 1 }).lean();
  let students = await Promise.all(rows.map(hydrateStudent));

  if (status === "completed") {
    if (Number.isInteger(selectedMonth) && selectedMonth >= 1 && selectedMonth <= 12) {
      students = students.filter((s) => s.fees.some((f) => f.monthNumber === selectedMonth && f.remainingAmount === 0));
    } else {
      students = students.filter((s) => s.fees.every((f) => f.remainingAmount === 0));
    }
  }

  if (status === "pending") {
    if (Number.isInteger(selectedMonth) && selectedMonth >= 1 && selectedMonth <= 12) {
      students = students.filter((s) => s.fees.some((f) => f.monthNumber === selectedMonth && f.remainingAmount > 0));
    } else {
      students = students.filter((s) => s.fees.some((f) => f.remainingAmount > 0));
    }
  }

  res.json(students);
}));

app.get("/api/students/:id", asyncHandler(async (req, res) => {
  const row = await Student.findById(Number(req.params.id)).lean();
  const student = await hydrateStudent(row);

  if (!student) return res.status(404).json({ message: "Student not found" });
  return res.json(student);
}));

app.post("/api/students", asyncHandler(async (req, res) => {
  const { name, className, batchYear, phoneNumber, joinDate } = req.body;

  if (!name || !className || !batchYear || !phoneNumber || !joinDate) {
    return res.status(400).json({ message: "Name, class, batch year, phone number, and join date are required" });
  }

  const id = await getNextId("students");

  const newStudent = await Student.create({
    _id: id,
    name: name.trim(),
    class_name: className.trim(),
    batch_year: String(batchYear).trim(),
    phone_number: String(phoneNumber).trim(),
    join_date: joinDate
  });

  await Promise.all(
    MONTHS.map((monthNumber) =>
      FeeRecord.findOneAndUpdate(
        { student_id: id, month_number: monthNumber },
        { $setOnInsert: { student_id: id, month_number: monthNumber, paid: false, paid_amount: 0, paid_date: null } },
        { upsert: true, new: true }
      )
    )
  );

  const student = await hydrateStudent(newStudent.toObject());
  return res.status(201).json(student);
}));

app.put("/api/students/:id", asyncHandler(async (req, res) => {
  const { name, className, batchYear, phoneNumber, joinDate } = req.body;

  if (!name || !className || !batchYear || !phoneNumber || !joinDate) {
    return res.status(400).json({ message: "Name, class, batch year, phone number, and join date are required" });
  }

  const result = await Student.findByIdAndUpdate(
    Number(req.params.id),
    {
      name: name.trim(),
      class_name: className.trim(),
      batch_year: String(batchYear).trim(),
      phone_number: String(phoneNumber).trim(),
      join_date: joinDate
    },
    { new: true }
  ).lean();

  if (!result) return res.status(404).json({ message: "Student not found" });

  const student = await hydrateStudent(result);
  return res.json(student);
}));

app.delete("/api/students/:id", asyncHandler(async (req, res) => {
  const result = await Student.findByIdAndDelete(Number(req.params.id));

  if (!result) return res.status(404).json({ message: "Student not found" });

  await FeeRecord.deleteMany({ student_id: Number(req.params.id) });
  return res.json({ success: true });
}));

app.put("/api/students/:id/fees", asyncHandler(async (req, res) => {
  const { fees } = req.body;

  if (!Array.isArray(fees) || fees.length !== 12) {
    return res.status(400).json({ message: "All 12 month fee records are required" });
  }

  const studentRow = await Student.findById(Number(req.params.id)).lean();
  if (!studentRow) return res.status(404).json({ message: "Student not found" });

  const adminSettings = await getAdminSettings();
  const tuitionFee = parseAmount(adminSettings?.currentYearFee);

  await Promise.all(
    fees.map((fee) => {
      const paidAmount = Math.min(parseAmount(fee.paidAmount), tuitionFee);
      const remainingAmount = Number(Math.max(tuitionFee - paidAmount, 0).toFixed(2));
      return FeeRecord.findOneAndUpdate(
        { student_id: Number(req.params.id), month_number: fee.monthNumber },
        {
          paid: remainingAmount === 0,
          paid_amount: paidAmount,
          paid_date: paidAmount > 0 ? fee.paidDate || null : null
        },
        { upsert: true }
      );
    })
  );

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

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });

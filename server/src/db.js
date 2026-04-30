require("dotenv").config();

const mongoose = require("mongoose");
const crypto = require("crypto");

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model("Counter", counterSchema);

async function getNextId(name) {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

const studentSchema = new mongoose.Schema({
  _id: Number,
  name: String,
  class_name: String,
  batch_year: String,
  phone_number: { type: String, default: "" },
  join_date: { type: String, default: "" },
  created_at: { type: Date, default: Date.now }
});
const Student = mongoose.model("Student", studentSchema);

const feeRecordSchema = new mongoose.Schema({
  student_id: Number,
  month_number: Number,
  paid: { type: Boolean, default: false },
  paid_amount: { type: Number, default: 0 },
  paid_date: { type: String, default: null }
});
feeRecordSchema.index({ student_id: 1, month_number: 1 }, { unique: true });
const FeeRecord = mongoose.model("FeeRecord", feeRecordSchema);

const adminSettingsSchema = new mongoose.Schema({
  _id: Number,
  username: String,
  password_hash: String,
  current_year_fee: { type: String, default: "" }
});
const AdminSettings = mongoose.model("AdminSettings", adminSettingsSchema);

async function initDb() {
  await mongoose.connect(readEnv("DATABASE_URL"));

  const defaultPasswordHash = crypto.createHash("sha256").update("admin123").digest("hex");
  await AdminSettings.findOneAndUpdate(
    { _id: 1 },
    { $setOnInsert: { _id: 1, username: "admin", password_hash: defaultPasswordHash, current_year_fee: "" } },
    { upsert: true, new: true }
  );
}

module.exports = { Student, FeeRecord, AdminSettings, getNextId, initDb };

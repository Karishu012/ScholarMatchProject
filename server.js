"use strict";

require("dotenv").config();

const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(os.homedir(), ".scholarmatch"));
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DATABASE_PATH = path.join(DATA_DIR, "scholarmatch.sqlite");
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (IS_PRODUCTION && (!SESSION_SECRET || SESSION_SECRET.length < 32 || SESSION_SECRET.includes("replace-this"))) {
  throw new Error("Set SESSION_SECRET to a unique random value of at least 32 characters in production.");
}
if (!IS_PRODUCTION && (!SESSION_SECRET || SESSION_SECRET.includes("replace-this"))) {
  console.warn("Using a temporary development session secret. Set SESSION_SECRET in .env to persist sessions across restarts.");
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const database = new Database(DATABASE_PATH);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");

database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    date_of_birth TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    father_name TEXT NOT NULL DEFAULT '',
    mother_name TEXT NOT NULL DEFAULT '',
    family_members INTEGER,
    parent_occupation TEXT NOT NULL DEFAULT '',
    annual_income INTEGER,
    course TEXT NOT NULL DEFAULT '',
    education_level TEXT NOT NULL DEFAULT '',
    institution TEXT NOT NULL DEFAULT '',
    current_year TEXT NOT NULL DEFAULT '',
    enrollment_year INTEGER,
    expected_graduation INTEGER,
    marks REAL,
    grading_scale TEXT NOT NULL DEFAULT 'percentage',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scholarships (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    amount INTEGER NOT NULL,
    deadline TEXT NOT NULL,
    courses_json TEXT NOT NULL,
    minimum_marks REAL NOT NULL,
    income_limit INTEGER,
    states_json TEXT NOT NULL,
    documents_json TEXT NOT NULL,
    symbol TEXT NOT NULL,
    color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending review' CHECK (status IN ('Pending review', 'Verified', 'More information', 'Rejected')),
    review_note TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    reviewed_by TEXT REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS documents_user_category_idx ON documents(user_id, category);
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scholarship_id TEXT NOT NULL REFERENCES scholarships(id),
    status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under review', 'Verified', 'More information', 'Awarded', 'Not selected')),
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, scholarship_id)
  );
  CREATE TABLE IF NOT EXISTS reminders (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scholarship_id TEXT NOT NULL REFERENCES scholarships(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, scholarship_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expired_idx ON sessions(expired_at);
`);

const scholarshipSeeds = [
  ["merit-futures", "Future Leaders Merit Award", "Bright Futures Foundation", 50000, "2026-11-18", ["Computer Science", "Engineering", "Business", "Science"], 80, null, [], ["academic_record", "enrollment_certificate"], "✳", ""],
  ["need-based", "Saksham Need-Based Scholarship", "Saksham Education Trust", 75000, "2026-11-07", ["Computer Science", "Engineering", "Arts & Humanities", "Science", "Education"], 65, 500000, [], ["academic_record", "income_certificate", "fee_receipt"], "₹", "gold"],
  ["women-in-tech", "Women in Technology Grant", "Digital Horizons India", 60000, "2026-11-24", ["Computer Science", "Engineering"], 70, null, [], ["academic_record", "enrollment_certificate"], "⌘", "blue"],
  ["state-talent", "Maharashtra State Talent Scholarship", "Department of Higher Education", 40000, "2026-12-05", ["Computer Science", "Engineering", "Business", "Arts & Humanities", "Medicine", "Science", "Law", "Education"], 75, 800000, ["Maharashtra"], ["academic_record", "enrollment_certificate", "income_certificate", "fee_receipt"], "⌂", "rose"],
  ["community-impact", "Community Impact Scholarship", "The Good Neighbour Fund", 30000, "2026-12-12", ["Business", "Arts & Humanities", "Education", "Law"], 60, 500000, [], ["academic_record", "income_certificate"], "♡", ""],
  ["science-innovators", "Young Science Innovators Fund", "National Science Circle", 90000, "2027-01-15", ["Computer Science", "Engineering", "Medicine", "Science"], 85, null, [], ["academic_record", "enrollment_certificate", "fee_receipt"], "⌬", "blue"],
];
const insertScholarship = database.prepare(`
  INSERT OR IGNORE INTO scholarships
  (id, name, provider, amount, deadline, courses_json, minimum_marks, income_limit, states_json, documents_json, symbol, color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const scholarship of scholarshipSeeds) {
  insertScholarship.run(
    ...scholarship.slice(0, 5),
    JSON.stringify(scholarship[5]),
    scholarship[6],
    scholarship[7],
    JSON.stringify(scholarship[8]),
    JSON.stringify(scholarship[9]),
    ...scholarship.slice(10),
  );
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: "20kb" }));
app.use((req, _res, next) => {
  if (!req.body) req.body = {};
  next();
});

class SqliteSessionStore extends session.Store {
  get(sid, callback = () => {}) {
    try {
      const row = database.prepare("SELECT sess, expired_at FROM sessions WHERE sid = ?").get(sid);
      if (!row) return callback(null, null);
      if (row.expired_at <= Date.now()) {
        database.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expiry = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      database.prepare(`
        INSERT INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired_at = excluded.expired_at
      `).run(sid, JSON.stringify(sess), expiry);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const expiry = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      database.prepare("UPDATE sessions SET expired_at = ? WHERE sid = ?").run(expiry, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      database.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

app.use(session({
  name: "scholarmatch.sid",
  secret: SESSION_SECRET && !SESSION_SECRET.includes("replace-this")
    ? SESSION_SECRET
    : crypto.randomBytes(48).toString("hex"),
  store: new SqliteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

const categories = {
  academic_record: "Academic marksheet / transcript",
  enrollment_certificate: "College enrollment / bonafide certificate",
  fee_receipt: "College fee payment receipt",
  income_certificate: "Family income certificate",
  id_proof: "Government ID proof",
};
const allowedProfileFields = [
  "fullName", "phone", "dateOfBirth", "gender", "address", "city", "state", "postalCode",
  "fatherName", "motherName", "familyMembers", "parentOccupation", "annualIncome", "course",
  "educationLevel", "institution", "currentYear", "enrollmentYear", "expectedGraduation", "marks",
];
const profileColumnByField = {
  fullName: "full_name", phone: "phone", dateOfBirth: "date_of_birth", gender: "gender",
  address: "address", city: "city", state: "state", postalCode: "postal_code",
  fatherName: "father_name", motherName: "mother_name", familyMembers: "family_members",
  parentOccupation: "parent_occupation", annualIncome: "annual_income", course: "course",
  educationLevel: "education_level", institution: "institution", currentYear: "current_year",
  enrollmentYear: "enrollment_year", expectedGraduation: "expected_graduation", marks: "marks",
};
const profileNumericFields = new Set(["familyMembers", "annualIncome", "enrollmentYear", "expectedGraduation", "marks"]);
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 12);
const selectValues = {
  gender: new Set(["", "Woman", "Man", "Non-binary", "Prefer not to say", "Self-describe"]),
  course: new Set(["", "Computer Science", "Engineering", "Business", "Arts & Humanities", "Medicine", "Science", "Law", "Education", "Other"]),
  educationLevel: new Set(["", "Undergraduate", "Postgraduate", "Diploma", "Other"]),
  currentYear: new Set(["", "1st year", "2nd year", "3rd year", "4th year", "5th year", "Other"]),
  state: new Set(["", "Andhra Pradesh", "Delhi", "Gujarat", "Karnataka", "Kerala", "Maharashtra", "Rajasthan", "Tamil Nadu", "Uttar Pradesh", "West Bengal", "Other"]),
};
const getUserByEmail = database.prepare("SELECT id, email, password_hash, role FROM users WHERE email = ?");
const getUserById = database.prepare("SELECT id, email, role FROM users WHERE id = ?");
const getProfile = database.prepare("SELECT * FROM profiles WHERE user_id = ?");
const getDocuments = database.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC, rowid DESC");
const getScholarship = database.prepare("SELECT * FROM scholarships WHERE id = ?");

function respondError(res, status, message) {
  return res.status(status).json({ error: message });
}

function normalizedEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sessionUser(req, res, next) {
  if (!req.session.userId) return respondError(res, 401, "Please sign in to continue.");
  const user = getUserById.get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return respondError(res, 401, "Your session has expired. Please sign in again.");
  }
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return respondError(res, 403, "Administrator access is required.");
  next();
}

function studentOnly(req, res, next) {
  if (req.user.role !== "student") return respondError(res, 403, "A student account is required.");
  next();
}

function csrfProtection(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const expected = req.session.csrfToken;
  const supplied = req.get("x-csrf-token");
  if (
    !expected ||
    !supplied ||
    expected.length !== supplied.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  ) {
    return respondError(res, 403, "The security token expired. Refresh the page and try again.");
  }
  const origin = req.get("origin");
  if (origin && origin !== `${req.protocol}://${req.get("host")}`) {
    return respondError(res, 403, "Cross-origin requests are not allowed.");
  }
  next();
}

app.use("/api", csrfProtection);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/auth/csrf", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.json({ csrfToken: req.session.csrfToken });
});
app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = getUserById.get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  const profile = getProfile.get(user.id);
  return res.json({ user: { id: user.id, email: user.email, role: user.role }, profile: profileToClient(profile) });
});

function profileToClient(profile) {
  if (!profile) return {};
  return {
    fullName: profile.full_name,
    phone: profile.phone,
    dateOfBirth: profile.date_of_birth,
    gender: profile.gender,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postal_code,
    fatherName: profile.father_name,
    motherName: profile.mother_name,
    familyMembers: profile.family_members,
    parentOccupation: profile.parent_occupation,
    annualIncome: profile.annual_income,
    course: profile.course,
    educationLevel: profile.education_level,
    institution: profile.institution,
    currentYear: profile.current_year,
    enrollmentYear: profile.enrollment_year,
    expectedGraduation: profile.expected_graduation,
    marks: profile.marks,
  };
}

function validateProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Provide valid profile details.";
  for (const [field, value] of Object.entries(input)) {
    if (!allowedProfileFields.includes(field)) return "The profile contains an unsupported field.";
    if (profileNumericFields.has(field)) {
      if (value === "" || value === null || value === undefined) continue;
      const number = Number(value);
      if (!Number.isFinite(number)) return `Enter a valid value for ${field}.`;
      if (field === "familyMembers" && (!Number.isInteger(number) || number < 1 || number > 30)) return "Family members must be between 1 and 30.";
      if (field === "annualIncome" && (!Number.isInteger(number) || number < 0 || number > 1000000000)) return "Enter an annual family income between ₹0 and ₹10 crore.";
      if ((field === "enrollmentYear" || field === "expectedGraduation") && (!Number.isInteger(number) || number < 1990 || number > 2100)) return "Enter a valid study year.";
      if (field === "marks" && (number < 0 || number > 100)) return "Marks must be between 0 and 100.";
    } else {
      if (typeof value !== "string" || value.length > (field === "address" ? 500 : 160)) return `Enter valid ${field} information.`;
      if (selectValues[field] && !selectValues[field].has(value)) return `Select a valid value for ${field}.`;
    }
  }
  if (input.phone && !/^[+()\d\s-]{7,20}$/.test(input.phone)) return "Enter a valid phone number.";
  if (input.postalCode && !/^[\p{L}\d -]{3,12}$/u.test(input.postalCode)) return "Enter a valid postal code.";
  if (input.dateOfBirth) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.dateOfBirth);
    if (!dateMatch) return "Enter a valid date of birth that is not in the future.";
    const [, year, month, day] = dateMatch;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      date.toISOString().slice(0, 10) !== input.dateOfBirth ||
      input.dateOfBirth > new Date().toISOString().slice(0, 10)
    ) return "Enter a valid date of birth that is not in the future.";
  }
  return null;
}

const createStudent = database.transaction((id, email, passwordHash, fullName) => {
  database.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'student')").run(id, email, passwordHash);
  database.prepare("INSERT INTO profiles (user_id, full_name) VALUES (?, ?)").run(id, fullName);
});

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many account attempts. Please wait a few minutes and try again." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
});

app.post("/api/auth/register", registrationLimiter, async (req, res, next) => {
  try {
    const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
    const email = normalizedEmail(req.body.email);
    const password = req.body.password;
    if (fullName.length < 2 || fullName.length > 100) return respondError(res, 400, "Enter your full name.");
    if (!validEmail(email)) return respondError(res, 400, "Enter a valid email address.");
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return respondError(res, 400, "Use a password with at least 12 characters.");
    }
    if (getUserByEmail.get(email)) return respondError(res, 409, "An account with that email already exists.");
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    createStudent(id, email, passwordHash, fullName);
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = id;
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.status(201).json({ user: { id, email, role: "student" }, profile: profileToClient(getProfile.get(id)), csrfToken: req.session.csrfToken });
      });
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return respondError(res, 409, "An account with that email already exists.");
    next(error);
  }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const email = normalizedEmail(req.body.email);
    const password = req.body.password;
    if (!validEmail(email) || typeof password !== "string" || password.length > 128) {
      return respondError(res, 400, "Enter a valid email and password.");
    }
    const user = getUserByEmail.get(email);
    const validPassword = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !validPassword) return respondError(res, 401, "Email or password is incorrect.");
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({
          user: { id: user.id, email: user.email, role: user.role },
          profile: profileToClient(getProfile.get(user.id)),
          csrfToken: req.session.csrfToken,
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", sessionUser, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("scholarmatch.sid", { httpOnly: true, secure: IS_PRODUCTION, sameSite: "lax" });
    res.status(204).end();
  });
});

app.get("/api/profile", sessionUser, studentOnly, (req, res) => {
  res.json({ profile: profileToClient(getProfile.get(req.user.id)) });
});

app.put("/api/profile", sessionUser, studentOnly, (req, res) => {
  const validationError = validateProfile(req.body);
  if (validationError) return respondError(res, 400, validationError);
  const assignments = [];
  const values = [];
  for (const [field, value] of Object.entries(req.body)) {
    assignments.push(`${profileColumnByField[field]} = ?`);
    values.push(profileNumericFields.has(field) && value !== "" && value !== null ? Number(value) : value || "");
  }
  if (assignments.length) {
    assignments.push("updated_at = CURRENT_TIMESTAMP");
    database.prepare(`UPDATE profiles SET ${assignments.join(", ")} WHERE user_id = ?`).run(...values, req.user.id);
  }
  res.json({ profile: profileToClient(getProfile.get(req.user.id)) });
});

function scholarshipToClient(scholarship, profile, documents) {
  const courses = JSON.parse(scholarship.courses_json);
  const states = JSON.parse(scholarship.states_json);
  const requiredDocuments = JSON.parse(scholarship.documents_json);
  const reasons = [];
  if (!courses.includes(profile.course)) reasons.push(`Course must be one of: ${courses.join(", ")}.`);
  if (!Number.isFinite(Number(profile.marks)) || Number(profile.marks) < scholarship.minimum_marks) reasons.push(`Requires at least ${scholarship.minimum_marks}% marks.`);
  if (scholarship.income_limit && (!Number.isFinite(Number(profile.annual_income)) || Number(profile.annual_income) > scholarship.income_limit)) reasons.push(`Annual family income must be ₹${new Intl.NumberFormat("en-IN").format(scholarship.income_limit)} or less.`);
  if (states.length && !states.includes(profile.state)) reasons.push(`Available to students from ${states.join(", ")}.`);
  const latestDocuments = new Map();
  for (const document of documents) {
    if (!latestDocuments.has(document.category)) latestDocuments.set(document.category, document);
  }
  const categoriesOnFile = new Set([...latestDocuments.values()]
    .filter((document) => !["Rejected", "More information"].includes(document.status))
    .map((document) => document.category));
  const missingDocuments = requiredDocuments.filter((category) => !categoriesOnFile.has(category));
  const documentStatus = Object.fromEntries([...latestDocuments].map(([category, document]) => [category, document.status]));
  const scoreParts = 2 + (scholarship.income_limit ? 1 : 0) + (states.length ? 1 : 0);
  return {
    id: scholarship.id, name: scholarship.name, provider: scholarship.provider, amount: scholarship.amount,
    deadline: scholarship.deadline, courses, minimumMarks: scholarship.minimum_marks,
    incomeLimit: scholarship.income_limit, states, requiredDocuments, symbol: scholarship.symbol, color: scholarship.color,
    eligible: reasons.length === 0, reasons,
    matchScore: Math.round(((scoreParts - reasons.length) / scoreParts) * 100),
    missingDocuments,
    documentStatus,
  };
}

app.get("/api/scholarships", sessionUser, studentOnly, (req, res) => {
  const profile = getProfile.get(req.user.id);
  const documents = getDocuments.all(req.user.id);
  const records = database.prepare("SELECT * FROM scholarships ORDER BY deadline").all();
  const applications = new Set(database.prepare("SELECT scholarship_id FROM applications WHERE user_id = ?").all(req.user.id).map((row) => row.scholarship_id));
  const reminders = new Set(database.prepare("SELECT scholarship_id FROM reminders WHERE user_id = ? AND active = 1").all(req.user.id).map((row) => row.scholarship_id));
  res.json({
    scholarships: records.map((scholarship) => ({
      ...scholarshipToClient(scholarship, profile, documents),
      applied: applications.has(scholarship.id),
      reminderActive: reminders.has(scholarship.id),
    })),
  });
});

app.get("/api/documents", sessionUser, studentOnly, (req, res) => {
  res.json({
    categories,
    documents: getDocuments.all(req.user.id).map((document) => ({
      id: document.id, category: document.category, categoryLabel: categories[document.category],
      originalName: document.original_name, fileSize: document.file_size, status: document.status,
      reviewNote: document.review_note, uploadedAt: document.uploaded_at, reviewedAt: document.reviewed_at,
    })),
  });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 100 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
    if (!allowed.has(file.mimetype)) return callback(new Error("Upload a PDF, JPEG, or PNG file."));
    callback(null, true);
  },
});

function sniffUpload(buffer, declaredType) {
  if (declaredType === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-") return { extension: ".pdf", mime: "application/pdf" };
  if (declaredType === "image/jpeg" && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: ".jpg", mime: "image/jpeg" };
  if (declaredType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: ".png", mime: "image/png" };
  return null;
}

app.post("/api/documents", sessionUser, studentOnly, (req, res, next) => {
  upload.single("document")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return respondError(res, 413, "Each document must be 5 MB or smaller.");
    if (error) return respondError(res, 400, error.message || "The document upload failed.");
    if (!req.file) return respondError(res, 400, "Choose a document to upload.");
    const category = req.body.category;
    if (!Object.hasOwn(categories, category)) return respondError(res, 400, "Choose a valid document type.");
    const detected = sniffUpload(req.file.buffer, req.file.mimetype);
    if (!detected) return respondError(res, 400, "The selected file does not match a supported PDF, JPEG, or PNG format.");
    const originalName = path.basename(req.file.originalname).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
    if (!originalName) return respondError(res, 400, "Enter a valid filename.");
    const id = crypto.randomUUID();
    const storedName = `${crypto.randomUUID()}${detected.extension}`;
    const targetPath = path.join(UPLOAD_DIR, storedName);
    try {
      fs.writeFileSync(targetPath, req.file.buffer, { flag: "wx", mode: 0o600 });
      database.prepare(`
        INSERT INTO documents (id, user_id, category, original_name, stored_name, mime_type, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.user.id, category, originalName, storedName, detected.mime, req.file.size);
      res.status(201).json({ document: { id, category, categoryLabel: categories[category], originalName, fileSize: req.file.size, status: "Pending review", uploadedAt: new Date().toISOString() } });
    } catch (saveError) {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      next(saveError);
    }
  });
});

const getDocumentById = database.prepare("SELECT * FROM documents WHERE id = ?");
app.get("/api/documents/:id/download", sessionUser, (req, res, next) => {
  const document = getDocumentById.get(req.params.id);
  if (!document) return respondError(res, 404, "Document not found.");
  if (req.user.role !== "admin" && document.user_id !== req.user.id) return respondError(res, 404, "Document not found.");
  const filePath = path.join(UPLOAD_DIR, document.stored_name);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${document.id}${path.extname(document.stored_name)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    if (error.code === "ENOENT") return respondError(res, 404, "The document file is no longer available.");
    next(error);
  });
  stream.pipe(res);
});

function profileReadyToApply(profile) {
  return Boolean(
    profile.full_name.trim() &&
    profile.phone.trim() &&
    profile.date_of_birth &&
    profile.gender &&
    profile.address.trim() &&
    profile.city.trim() &&
    profile.state &&
    profile.postal_code.trim() &&
    profile.father_name.trim() &&
    profile.mother_name.trim() &&
    profile.family_members !== null && profile.family_members !== "" && Number(profile.family_members) > 0 &&
    profile.annual_income !== null && profile.annual_income !== "" && Number(profile.annual_income) >= 0 &&
    profile.course &&
    profile.education_level &&
    profile.institution.trim() &&
    profile.current_year &&
    profile.marks !== null && profile.marks !== "" && Number(profile.marks) >= 0
  );
}

app.post("/api/applications", sessionUser, studentOnly, (req, res) => {
  const scholarship = typeof req.body.scholarshipId === "string" ? getScholarship.get(req.body.scholarshipId) : null;
  if (!scholarship) return respondError(res, 404, "Scholarship not found.");
  const profile = getProfile.get(req.user.id);
  if (!profileReadyToApply(profile)) return respondError(res, 400, "Complete your personal, family, and education profile before applying.");
  const match = scholarshipToClient(scholarship, profile, getDocuments.all(req.user.id));
  if (!match.eligible) return respondError(res, 400, `You do not meet the eligibility requirements: ${match.reasons.join(" ")}`);
  if (match.missingDocuments.length) {
    const labels = match.missingDocuments.map((category) => categories[category]).join(", ");
    return respondError(res, 400, `Upload the required documents before applying: ${labels}.`);
  }
  try {
    const applicationId = crypto.randomUUID();
    database.prepare("INSERT INTO applications (id, user_id, scholarship_id) VALUES (?, ?, ?)").run(applicationId, req.user.id, scholarship.id);
    res.status(201).json({ application: { id: applicationId, scholarshipId: scholarship.id, status: "Submitted", submittedAt: new Date().toISOString() } });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return respondError(res, 409, "You have already applied for this scholarship.");
    throw error;
  }
});

app.get("/api/applications", sessionUser, studentOnly, (req, res) => {
  const applications = database.prepare(`
    SELECT a.id, a.scholarship_id, a.status, a.submitted_at, s.name, s.provider, s.amount, s.deadline,
      s.symbol, s.color, s.documents_json
    FROM applications a JOIN scholarships s ON s.id = a.scholarship_id
    WHERE a.user_id = ? ORDER BY a.submitted_at DESC
  `).all(req.user.id);
  res.json({ applications: applications.map((application) => ({
    id: application.id,
    scholarshipId: application.scholarship_id,
    status: application.status,
    submittedAt: application.submitted_at,
    name: application.name,
    provider: application.provider,
    amount: application.amount,
    deadline: application.deadline,
    symbol: application.symbol,
    color: application.color,
    requiredDocuments: JSON.parse(application.documents_json),
  })) });
});

app.get("/api/reminders", sessionUser, studentOnly, (req, res) => {
  res.json({ reminders: database.prepare("SELECT scholarship_id FROM reminders WHERE user_id = ? AND active = 1").all(req.user.id).map((row) => row.scholarship_id) });
});

app.put("/api/reminders/:scholarshipId", sessionUser, studentOnly, (req, res) => {
  if (!getScholarship.get(req.params.scholarshipId)) return respondError(res, 404, "Scholarship not found.");
  if (typeof req.body.active !== "boolean") return respondError(res, 400, "Choose whether the reminder should be on or off.");
  if (req.body.active) {
    database.prepare("INSERT INTO reminders (user_id, scholarship_id, active) VALUES (?, ?, 1) ON CONFLICT(user_id, scholarship_id) DO UPDATE SET active = 1").run(req.user.id, req.params.scholarshipId);
  } else {
    database.prepare("DELETE FROM reminders WHERE user_id = ? AND scholarship_id = ?").run(req.user.id, req.params.scholarshipId);
  }
  res.json({ active: req.body.active });
});

app.get("/api/admin/applications", sessionUser, adminOnly, (_req, res) => {
  const applications = database.prepare(`
    SELECT a.id, a.user_id, a.scholarship_id, a.status, a.submitted_at, s.name, s.provider, s.amount,
      s.deadline, s.symbol, s.color, u.email, p.full_name
    FROM applications a
    JOIN scholarships s ON s.id = a.scholarship_id
    JOIN users u ON u.id = a.user_id
    JOIN profiles p ON p.user_id = a.user_id
    ORDER BY a.submitted_at DESC
  `).all().map((application) => ({
    id: application.id, userId: application.user_id, scholarshipId: application.scholarship_id,
    status: application.status, submittedAt: application.submitted_at, name: application.name,
    provider: application.provider, amount: application.amount, deadline: application.deadline,
    symbol: application.symbol, color: application.color, email: application.email,
    applicant: application.full_name,
  }));
  res.json({ applications });
});

app.patch("/api/admin/applications/:id", sessionUser, adminOnly, (req, res) => {
  const statuses = new Set(["Submitted", "Under review", "Verified", "More information", "Awarded", "Not selected"]);
  if (typeof req.body.status !== "string" || !statuses.has(req.body.status)) return respondError(res, 400, "Choose a valid application status.");
  const result = database.prepare("UPDATE applications SET status = ? WHERE id = ?").run(req.body.status, req.params.id);
  if (!result.changes) return respondError(res, 404, "Application not found.");
  res.json({ status: req.body.status });
});

app.get("/api/admin/documents", sessionUser, adminOnly, (_req, res) => {
  const documents = database.prepare(`
    SELECT d.id, d.user_id, d.category, d.original_name, d.file_size, d.status, d.review_note,
      d.uploaded_at, d.reviewed_at, u.email, p.full_name
    FROM documents d JOIN users u ON u.id = d.user_id JOIN profiles p ON p.user_id = d.user_id
    ORDER BY CASE d.status WHEN 'Pending review' THEN 0 ELSE 1 END, d.uploaded_at ASC
  `).all().map((document) => ({
    id: document.id, userId: document.user_id, category: document.category,
    categoryLabel: categories[document.category], originalName: document.original_name,
    fileSize: document.file_size, status: document.status, reviewNote: document.review_note,
    uploadedAt: document.uploaded_at, reviewedAt: document.reviewed_at,
    applicant: document.full_name, email: document.email,
  }));
  res.json({ documents });
});

app.patch("/api/admin/documents/:id", sessionUser, adminOnly, (req, res) => {
  const statuses = new Set(["Verified", "More information", "Rejected"]);
  if (typeof req.body.status !== "string" || !statuses.has(req.body.status)) return respondError(res, 400, "Choose a valid verification decision.");
  const note = typeof req.body.reviewNote === "string" ? req.body.reviewNote.trim() : "";
  if (note.length > 500) return respondError(res, 400, "Review notes must be 500 characters or fewer.");
  if (["More information", "Rejected"].includes(req.body.status) && !note) return respondError(res, 400, "Add a note explaining this verification decision.");
  const result = database.prepare(`
    UPDATE documents SET status = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
    WHERE id = ?
  `).run(req.body.status, note, req.user.id, req.params.id);
  if (!result.changes) return respondError(res, 404, "Document not found.");
  res.json({ status: req.body.status, reviewNote: note });
});

if (Boolean(process.env.ADMIN_EMAIL) !== Boolean(process.env.ADMIN_PASSWORD)) {
  throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD, or leave both unset.");
}
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = normalizedEmail(process.env.ADMIN_EMAIL);
  if (!validEmail(email) || process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD.includes("replace-this")) {
    throw new Error("ADMIN_EMAIL must be valid and ADMIN_PASSWORD must be unique and at least 12 characters.");
  }
  if (!getUserByEmail.get(email)) {
    const id = crypto.randomUUID();
    const passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    database.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(id, email, passwordHash);
    database.prepare("INSERT INTO profiles (user_id) VALUES (?)").run(id);
    console.log("Created the initial administrator account from ADMIN_EMAIL and ADMIN_PASSWORD.");
  }
} else {
  console.warn("ADMIN_EMAIL and ADMIN_PASSWORD are not configured. Administrator sign-in is unavailable.");
}

app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(ROOT, "index.html"));
});
app.get("/styles.css", (_req, res) => res.sendFile(path.join(ROOT, "styles.css")));
app.get("/app.js", (_req, res) => res.sendFile(path.join(ROOT, "app.js")));
app.use("/api", (_req, res) => respondError(res, 404, "API endpoint not found."));
app.use((error, _req, res, _next) => {
  console.error("ScholarMatch request failed:", error);
  if (res.headersSent) return;
  res.status(500).json({ error: "The server could not complete the request." });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`ScholarMatch is running at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DATABASE_PATH}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);

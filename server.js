const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataPath = path.join(root, "data", "bookings.json");
const port = Number(process.env.PORT || 8080);
const googleSheetsUrl = String(process.env.GOOGLE_SHEETS_WEB_APP_URL || "").trim();
const googleSheetsToken = String(process.env.GOOGLE_SHEETS_SYNC_TOKEN || "").trim();
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false } })
  : null;
let lastGoogleSheetsSync = "";
let lastGoogleSheetsError = "";

const columns = [
  "id", "inquiryDate", "customerName", "contactNumber", "chassisNumber",
  "registrationNumber", "job", "serviceAdvisor", "bookingDate", "bookingTime",
  "status", "paymentMode", "remarks", "createdAt", "updatedAt"
];

function toDb(booking) {
  const now = new Date().toISOString();
  return {
    id: String(booking.id || Date.now()),
    inquiryDate: String(booking.inquiryDate || "").slice(0, 10),
    customerName: String(booking.customerName || "").trim(),
    contactNumber: String(booking.contactNumber || "").trim(),
    chassisNumber: String(booking.chassisNumber || "").trim().toUpperCase(),
    registrationNumber: String(booking.registrationNumber || "").trim(),
    job: String(booking.job || "Service").trim(),
    serviceAdvisor: String(booking.serviceAdvisor || "").trim(),
    bookingDate: String(booking.bookingDate || "").slice(0, 10),
    bookingTime: String(booking.bookingTime || "").slice(0, 5),
    status: String(booking.status || "Booked").trim(),
    paymentMode: String(booking.paymentMode || "").trim(),
    remarks: String(booking.remarks || "").trim(),
    createdAt: String(booking.createdAt || now),
    updatedAt: now
  };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    create table if not exists bookings (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  const { rows } = await pool.query("select count(*)::int as count from bookings");
  if (rows[0].count === 0) {
    const seed = JSON.parse(await fs.readFile(dataPath, "utf8")).map(toDb);
    for (const booking of seed) {
      await pool.query("insert into bookings (id, data) values ($1, $2)", [booking.id, booking]);
    }
  }
}

async function readBookings() {
  if (pool) {
    const { rows } = await pool.query("select data from bookings order by data->>'bookingDate', data->>'bookingTime'");
    return rows.map((row) => row.data);
  }
  return JSON.parse(await fs.readFile(dataPath, "utf8"));
}

async function syncGoogleSheets() {
  if (!googleSheetsUrl || !googleSheetsToken) return false;
  const response = await fetch(googleSheetsUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      token: googleSheetsToken,
      syncedAt: new Date().toISOString(),
      bookings: await readBookings()
    })
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Google Sheets returned ${response.status}: ${responseText}`);
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`Google Sheets returned an invalid response: ${responseText.slice(0, 200)}`);
  }
  if (!result.ok) throw new Error(result.error || "Google Sheets sync failed");
  lastGoogleSheetsSync = new Date().toISOString();
  lastGoogleSheetsError = "";
  return true;
}

async function syncGoogleSheetsSafe() {
  try {
    return await syncGoogleSheets();
  } catch (error) {
    lastGoogleSheetsError = error.message;
    console.error("Google Sheets sync failed:", error.message);
    return false;
  }
}

async function saveBooking(booking) {
  const clean = toDb(booking);
  if (pool) {
    await pool.query(
      "insert into bookings (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
      [clean.id, clean]
    );
  } else {
    const bookings = await readBookings();
    const index = bookings.findIndex((item) => item.id === clean.id);
    if (index === -1) bookings.push(clean);
    else bookings[index] = clean;
    await fs.writeFile(dataPath, `${JSON.stringify(bookings, null, 2)}\n`);
  }
  return clean;
}

async function deleteBooking(id) {
  if (pool) {
    await pool.query("delete from bookings where id = $1", [id]);
    return;
  }
  const bookings = (await readBookings()).filter((item) => item.id !== id);
  await fs.writeFile(dataPath, `${JSON.stringify(bookings, null, 2)}\n`);
}

function bySchedule(a, b) {
  return `${a.bookingDate || ""} ${a.bookingTime || ""}`.localeCompare(`${b.bookingDate || ""} ${b.bookingTime || ""}`);
}

function vinMaster(bookings) {
  const groups = bookings.reduce((acc, booking) => {
    const vin = String(booking.chassisNumber || "").toUpperCase();
    if (!vin) return acc;
    (acc[vin] ||= []).push(booking);
    return acc;
  }, {});
  return Object.entries(groups).map(([chassisNumber, history]) => {
    const sorted = history.sort(bySchedule);
    const latest = sorted[sorted.length - 1] || {};
    return { chassisNumber, latest, total: sorted.length, history: sorted };
  });
}

function contentType(file) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  }[path.extname(file).toLowerCase()] || "application/octet-stream";
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = path.normalize(path.join(publicDir, pathname));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const file = await fs.readFile(target);
    res.writeHead(200, { "Content-Type": contentType(target) });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      database: Boolean(pool),
      googleSheets: Boolean(googleSheetsUrl && googleSheetsToken),
      googleSheetsLastSync: lastGoogleSheetsSync || null,
      googleSheetsError: lastGoogleSheetsError || null
    });
  }
  if (req.method === "GET" && url.pathname === "/api/bookings") return sendJson(res, 200, await readBookings());
  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const saved = await saveBooking(await parseBody(req));
    await syncGoogleSheetsSafe();
    return sendJson(res, 201, saved);
  }
  if (req.method === "PUT" && url.pathname.startsWith("/api/bookings/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const saved = await saveBooking({ ...(await parseBody(req)), id });
    await syncGoogleSheetsSafe();
    return sendJson(res, 200, saved);
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/bookings/")) {
    await deleteBooking(decodeURIComponent(url.pathname.split("/").pop()));
    await syncGoogleSheetsSafe();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/sync-google-sheets") {
    const synced = await syncGoogleSheetsSafe();
    return sendJson(res, synced ? 200 : 503, {
      ok: synced,
      error: lastGoogleSheetsError || null
    });
  }
  if (req.method === "GET" && url.pathname === "/api/vins") return sendJson(res, 200, vinMaster(await readBookings()));
  if (req.method === "GET" && url.pathname === "/api/export.csv") {
    const rows = await readBookings();
    const csv = [columns.join(","), ...rows.map((row) => columns.map((key) => csvEscape(row[key])).join(","))].join("\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=bestune_bookings_master.csv" });
    res.end(csv);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
}

async function start() {
  await initDb();
  await syncGoogleSheetsSafe();
  http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res).catch((error) => sendJson(res, 500, { error: error.message }));
      return;
    }
    serveStatic(req, res).catch((error) => {
      res.writeHead(500);
      res.end(error.message);
    });
  }).listen(port, () => console.log(`Bestune Booking listening on ${port}`));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

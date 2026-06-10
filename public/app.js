const storageKey = "bestuneBookingsGithub";
const deletePassword = "Bestune@2026";
const statusValues = ["Booked", "Confirmed", "Arrived", "Completed", "Cancelled", "Rescheduled"];
const paymentValues = ["Cash", "Payment link", "Card", "Under service contract"];
const advisorValues = ["Heba", "Kaoutar", "Rana"];

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  appId: ""
};
const firebaseDataPath = "bestune-booking/bookings";

const cloud = {
  applyingRemote: false,
  ready: false,
  ref: null,
  set: null
};

const state = {
  bookings: [],
  filtered: [],
  view: "dashboard",
  calendarDate: new Date(2026, 5, 1),
  selectedDate: "",
  lastRemoteSignature: ""
};
const apiMode = location.protocol.startsWith("http");
const autoRefreshMs = 5000;
let bookingSubmitInProgress = false;

const $ = (selector) => document.querySelector(selector);
const els = {
  search: $("#searchInput"),
  kpis: $("#kpis"),
  monthLabel: $("#monthLabel"),
  calendarGrid: $("#calendarGrid"),
  advisorBars: $("#advisorBars"),
  statusChart: $("#statusChart"),
  statusLegend: $("#statusLegend"),
  calendarList: $("#calendarList"),
  calendarCount: $("#calendarCount"),
  bookingRows: $("#bookingRows"),
  mobileBookingCards: $("#mobileBookingCards"),
  vinRows: $("#vinRows"),
  vinCount: $("#vinCount"),
  form: $("#bookingForm"),
  formMessage: $("#formMessage"),
  vinWarning: $("#vinWarning"),
  syncStatus: $("#syncStatus")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[char]));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function prettyDate(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function prettyTime(value) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  return new Date(2026, 0, 1, h, m).toLocaleTimeString("en-AE", { hour: "numeric", minute: "2-digit" });
}

function bySchedule(a, b) {
  return `${a.bookingDate || ""} ${a.bookingTime || ""}`.localeCompare(`${b.bookingDate || ""} ${b.bookingTime || ""}`);
}

function saveLocal() {
  localStorage.setItem(storageKey, JSON.stringify(state.bookings));
  if (cloud.ready && !cloud.applyingRemote) {
    cloud.set(cloud.ref, state.bookings).catch(() => setSyncStatus("Cloud save failed"));
  }
}

async function persistBooking(booking) {
  if (!apiMode) {
    saveLocal();
    return booking;
  }
  const exists = state.bookings.some((item) => item.id === booking.id);
  const response = await fetch(`/api/bookings${exists ? `/${encodeURIComponent(booking.id)}` : ""}`, {
    method: exists ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking)
  });
  if (!response.ok) throw new Error((await response.json()).error || "Save failed");
  return response.json();
}

async function removeBooking(id) {
  if (!apiMode) {
    state.bookings = state.bookings.filter((item) => item.id !== id);
    saveLocal();
    return;
  }
  const response = await fetch(`/api/bookings/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error((await response.json()).error || "Delete failed");
}

function setSyncStatus(text) {
  if (els.syncStatus) els.syncStatus.textContent = text;
}

function bookingsSignature(bookings) {
  return JSON.stringify(bookings.map((booking) => ({
    id: booking.id,
    updatedAt: booking.updatedAt,
    status: booking.status,
    bookingDate: booking.bookingDate,
    bookingTime: booking.bookingTime,
    chassisNumber: booking.chassisNumber,
    remarks: booking.remarks
  })));
}

function userIsEditing() {
  const active = document.activeElement;
  if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return true;
  return [...document.querySelectorAll(".row-message, .remarks-message")].some((node) => node.textContent.trim() === "Unsaved");
}

async function refreshFromServer({ force = false } = {}) {
  if (!apiMode) return;
  if (!force && userIsEditing()) return;
  try {
    setSyncStatus("Refreshing...");
    const response = await fetch("/api/bookings", { cache: "no-store" });
    if (!response.ok) throw new Error("Refresh failed");
    const remoteBookings = await response.json();
    const signature = bookingsSignature(remoteBookings);
    if (!force && signature === state.lastRemoteSignature) {
      setSyncStatus("Shared live");
      return;
    }
    state.bookings = remoteBookings;
    state.lastRemoteSignature = signature;
    render();
    setSyncStatus("Shared live");
  } catch {
    setSyncStatus("Shared refresh failed");
  }
}

async function manualRefresh() {
  const button = $("#refreshData");
  if (button) button.disabled = true;
  await refreshFromServer({ force: true });
  if (button) button.disabled = false;
}

function startAutoRefresh() {
  if (!apiMode) return;
  setInterval(() => refreshFromServer(), autoRefreshMs);
}

function hasFirebaseConfig() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId && firebaseConfig.appId);
}

async function setupCloudSync() {
  if (!hasFirebaseConfig()) {
    setSyncStatus("Local mode");
    return;
  }
  try {
    setSyncStatus("Connecting...");
    const appModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
    const dbModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js");
    const app = appModule.initializeApp(firebaseConfig);
    const database = dbModule.getDatabase(app);
    cloud.ref = dbModule.ref(database, firebaseDataPath);
    cloud.set = dbModule.set;
    cloud.ready = true;
    dbModule.onValue(cloud.ref, (snapshot) => {
      const remoteBookings = snapshot.val();
      if (Array.isArray(remoteBookings)) {
        cloud.applyingRemote = true;
        state.bookings = remoteBookings;
        localStorage.setItem(storageKey, JSON.stringify(state.bookings));
        render();
        cloud.applyingRemote = false;
        setSyncStatus("Shared live data");
        return;
      }
      if (!remoteBookings && state.bookings.length) {
        cloud.set(cloud.ref, state.bookings);
        setSyncStatus("Shared live data");
      }
    });
  } catch {
    setSyncStatus("Local mode");
  }
}

function options(values, selected) {
  return values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function advisorCounts(bookings) {
  return bookings.reduce((acc, booking) => {
    const key = booking.serviceAdvisor || "Unassigned";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function statusCounts(bookings) {
  return bookings.reduce((acc, booking) => {
    const key = booking.status || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function vinMaster(bookings) {
  const groups = bookings.reduce((acc, booking) => {
    const vin = (booking.chassisNumber || "").trim().toUpperCase();
    if (!vin) return acc;
    (acc[vin] ||= []).push(booking);
    return acc;
  }, {});

  return Object.entries(groups).map(([chassisNumber, history]) => {
    const sorted = [...history].sort(bySchedule);
    const latest = sorted[sorted.length - 1] || {};
    return { chassisNumber, latest, total: sorted.length, history: sorted };
  }).sort((a, b) => b.total - a.total || a.chassisNumber.localeCompare(b.chassisNumber));
}

function applyFilter() {
  const term = els.search.value.trim().toLowerCase();
  state.filtered = !term ? [...state.bookings] : state.bookings.filter((booking) => [
    booking.customerName, booking.contactNumber, booking.chassisNumber,
    booking.registrationNumber, booking.serviceAdvisor, booking.status, booking.paymentMode
  ].join(" ").toLowerCase().includes(term));
}

function renderKpis() {
  const rows = state.filtered;
  const upcoming = rows.filter((booking) => booking.bookingDate >= todayKey() && booking.status !== "Cancelled").length;
  const next = [...rows].filter((booking) => booking.bookingDate >= todayKey()).sort(bySchedule)[0];
  const cards = [
    ["Total bookings", rows.length],
    ["Upcoming", upcoming],
    ["Booked", rows.filter((booking) => booking.status === "Booked").length],
    ["Unique VIN", vinMaster(rows).length],
    ["Next booking", next ? `${prettyDate(next.bookingDate)} ${prettyTime(next.bookingTime)}` : "None"]
  ];
  els.kpis.innerHTML = cards.map(([label, value]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderCalendar() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  els.monthLabel.textContent = state.calendarDate.toLocaleDateString("en-AE", { month: "long", year: "numeric" });
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const byDay = state.bookings.reduce((acc, booking) => {
    (acc[booking.bookingDate] ||= []).push(booking);
    return acc;
  }, {});
  els.calendarGrid.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = dateKey(day);
    const events = (byDay[key] || []).sort(bySchedule);
    return `<button class="day ${day.getMonth() === month ? "" : "outside"}" data-date="${key}" type="button">
      <span class="day-number"><span>${day.getDate()}</span>${events.length ? `<span class="badge">${events.length}</span>` : ""}</span>
      ${events.slice(0, 3).map((event) => {
        const completed = String(event.status || "").toLowerCase() === "completed";
        return `<span class="event ${completed ? "event-completed" : ""}">
          ${prettyTime(event.bookingTime)} ${escapeHtml(event.customerName)}${completed ? " - Completed" : ""}
        </span>`;
      }).join("")}
    </button>`;
  }).join("");
}

function renderStatus() {
  const entries = Object.entries(statusCounts(state.filtered)).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, entries.reduce((sum, [, value]) => sum + value, 0));
  const colors = ["#86c52a", "#2f6f4e", "#7f8c8d", "#f2b84b", "#d95d39", "#4b6cb7"];
  let pos = 0;
  const segments = entries.map(([, count], index) => {
    const start = pos;
    pos += (count / total) * 100;
    return `${colors[index % colors.length]} ${start}% ${pos}%`;
  });
  els.statusChart.style.background = entries.length ? `conic-gradient(${segments.join(", ")})` : "#eef4e9";
  els.statusChart.innerHTML = `<strong>${total}</strong>`;
  els.statusLegend.innerHTML = entries.map(([name, count], index) => `<div class="legend-row"><span><i class="swatch" style="background:${colors[index % colors.length]}"></i>${escapeHtml(name)}</span><strong>${count}</strong></div>`).join("");
}

function renderAdvisors() {
  const counts = advisorCounts(state.filtered);
  const max = Math.max(1, ...Object.values(counts));
  els.advisorBars.innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => `
    <div><div class="bar-label"><strong>${escapeHtml(name)}</strong><span>${count}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(count / max) * 100}%"></div></div></div>
  `).join("");
}

function renderCalendarList() {
  const rows = [...state.bookings].filter((booking) => !state.selectedDate || booking.bookingDate === state.selectedDate).sort(bySchedule);
  els.calendarCount.textContent = state.selectedDate ? `${rows.length} entries on ${prettyDate(state.selectedDate)}` : `${rows.length} entries`;
  els.calendarList.innerHTML = rows.map((booking) => {
    const completed = String(booking.status || "").trim().toLowerCase() === "completed";
    return `<article class="booking-card ${completed ? "booking-card-completed" : ""}">
      <strong>${prettyDate(booking.bookingDate)}<br>${prettyTime(booking.bookingTime)}</strong>
      <div><strong>${escapeHtml(booking.customerName)}</strong><div>${escapeHtml(booking.chassisNumber)} | Reg. ${escapeHtml(booking.registrationNumber || "-")}</div></div>
      <span>${escapeHtml(booking.serviceAdvisor)}</span>
      <span class="badge ${completed ? "badge-completed" : ""}">${escapeHtml(booking.status)}</span>
    </article>`;
  }).join("");
}

function renderBookings() {
  const rows = [...state.filtered].sort(bySchedule);
  els.bookingRows.innerHTML = rows.map((booking) => `<tr data-id="${escapeHtml(booking.id)}">
    <td><input class="table-input" data-field="bookingDate" type="date" value="${escapeHtml(booking.bookingDate)}"></td>
    <td><input class="table-input" data-field="bookingTime" type="time" value="${escapeHtml(booking.bookingTime)}"></td>
    <td><input class="table-input" data-field="customerName" value="${escapeHtml(booking.customerName)}"></td>
    <td><input class="table-input" data-field="contactNumber" value="${escapeHtml(booking.contactNumber)}"></td>
    <td><input class="table-input" data-field="chassisNumber" value="${escapeHtml(booking.chassisNumber)}"><button class="open-vin" data-vin="${escapeHtml(booking.chassisNumber)}" type="button">Open VIN</button></td>
    <td><input class="table-input" data-field="registrationNumber" value="${escapeHtml(booking.registrationNumber || "")}"></td>
    <td><select class="table-input" data-field="serviceAdvisor"><option value="">Select</option>${options(advisorValues, booking.serviceAdvisor || "")}</select></td>
    <td><select class="table-input" data-field="paymentMode"><option value="">Select</option>${options(paymentValues, booking.paymentMode || "")}</select></td>
    <td><select class="table-input" data-field="status">${options(statusValues, booking.status)}</select><button class="save-row" type="button">Save</button><button class="delete-row" type="button">Delete</button><span class="row-message"></span></td>
  </tr>`).join("");
  els.mobileBookingCards.innerHTML = rows.map((booking) => `<article class="mobile-edit-card" data-id="${escapeHtml(booking.id)}">
    <div class="mobile-card-head">
      <strong>${escapeHtml(booking.customerName)}</strong>
      <span class="badge">${escapeHtml(booking.status || "")}</span>
    </div>
    <label>Date<input class="table-input" data-field="bookingDate" type="date" value="${escapeHtml(booking.bookingDate)}"></label>
    <label>Time<input class="table-input" data-field="bookingTime" type="time" value="${escapeHtml(booking.bookingTime)}"></label>
    <label>Customer<input class="table-input" data-field="customerName" value="${escapeHtml(booking.customerName)}"></label>
    <label>Contact<input class="table-input" data-field="contactNumber" value="${escapeHtml(booking.contactNumber)}"></label>
    <label>VIN<input class="table-input" data-field="chassisNumber" value="${escapeHtml(booking.chassisNumber)}"></label>
    <button class="open-vin" data-vin="${escapeHtml(booking.chassisNumber)}" type="button">Open VIN</button>
    <label>Registration<input class="table-input" data-field="registrationNumber" value="${escapeHtml(booking.registrationNumber || "")}"></label>
    <label>Advisor<select class="table-input" data-field="serviceAdvisor"><option value="">Select</option>${options(advisorValues, booking.serviceAdvisor || "")}</select></label>
    <label>Payment<select class="table-input" data-field="paymentMode"><option value="">Select</option>${options(paymentValues, booking.paymentMode || "")}</select></label>
    <label>Status<select class="table-input" data-field="status">${options(statusValues, booking.status)}</select></label>
    <button class="save-row" type="button">Save booking</button>
    <button class="delete-row" type="button">Delete booking</button>
    <span class="row-message"></span>
  </article>`).join("");
}

function renderVins() {
  const vehicles = vinMaster(state.filtered);
  els.vinCount.textContent = `${vehicles.length} unique VIN records`;
  els.vinRows.innerHTML = vehicles.map((vehicle) => `<article class="vin-card" data-vin="${escapeHtml(vehicle.chassisNumber)}">
    <div class="vin-title-row">
      <div>
        <h2>${escapeHtml(vehicle.chassisNumber)}</h2>
        <p>${escapeHtml(vehicle.latest.customerName || "")} | ${escapeHtml(vehicle.latest.contactNumber || "-")} | Reg. ${escapeHtml(vehicle.latest.registrationNumber || "-")}</p>
        <span class="badge">${vehicle.total} service booking${vehicle.total === 1 ? "" : "s"}</span>
      </div>
      <button class="delete-vin" data-vin="${escapeHtml(vehicle.chassisNumber)}" type="button">Delete VIN</button>
    </div>
    ${vehicle.history.map((booking) => `<div class="history-row" data-id="${escapeHtml(booking.id)}">
      <strong>${prettyDate(booking.bookingDate)} ${prettyTime(booking.bookingTime)}</strong>
      <span>${escapeHtml(booking.status || "-")}</span>
      <span>${escapeHtml(booking.serviceAdvisor || "-")}</span>
      <span>${escapeHtml(booking.paymentMode || "No payment mode")}</span>
      <div><textarea class="remarks-input" rows="2">${escapeHtml(booking.remarks || "")}</textarea><button class="save-remarks" type="button">Save remarks</button><button class="delete-history-row" type="button">Delete booking</button><span class="remarks-message"></span></div>
    </div>`).join("")}
  </article>`).join("");
}

function render() {
  applyFilter();
  renderKpis();
  renderCalendar();
  renderStatus();
  renderAdvisors();
  renderCalendarList();
  renderBookings();
  renderVins();
}

function showView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === `${view}View`));
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  history.replaceState(null, "", `#${view}`);
}

function rowBooking(row) {
  const booking = state.bookings.find((item) => item.id === row.dataset.id);
  const updates = {};
  row.querySelectorAll("[data-field]").forEach((field) => updates[field.dataset.field] = field.value.trim());
  return { ...booking, ...updates, chassisNumber: (updates.chassisNumber || "").toUpperCase(), updatedAt: new Date().toISOString() };
}

async function saveBookingRow(row) {
  const booking = rowBooking(row);
  const index = state.bookings.findIndex((item) => item.id === booking.id);
  if (index === -1) return;
  state.bookings[index] = await persistBooking(booking);
  row.querySelector(".row-message").textContent = "Saved";
  render();
}

async function saveAllRows() {
  const selector = matchMedia("(max-width: 780px)").matches ? "#mobileBookingCards .mobile-edit-card" : "#bookingRows tr";
  for (const row of document.querySelectorAll(selector)) await saveBookingRow(row);
}

function confirmDeletePassword() {
  const entered = prompt("Enter deletion password");
  if (entered === null) return false;
  if (entered !== deletePassword) {
    alert("Incorrect password. Deletion cancelled.");
    return false;
  }
  return true;
}

async function deleteBooking(id) {
  const booking = state.bookings.find((item) => item.id === id);
  if (!booking) return;
  if (!confirmDeletePassword()) return;
  if (!confirm(`Delete booking for ${booking.customerName} / ${booking.chassisNumber}?`)) return;
  await removeBooking(id);
  state.bookings = state.bookings.filter((item) => item.id !== id);
  render();
}

async function deleteVin(vin) {
  const total = state.bookings.filter((booking) => booking.chassisNumber === vin).length;
  if (!total) return;
  if (!confirmDeletePassword()) return;
  if (!confirm(`Delete VIN ${vin} and all ${total} booking record(s)?`)) return;
  for (const booking of state.bookings.filter((item) => item.chassisNumber === vin)) await removeBooking(booking.id);
  state.bookings = state.bookings.filter((booking) => booking.chassisNumber !== vin);
  els.search.value = "";
  render();
  showView("vins");
}

async function addBooking(event) {
  event.preventDefault();
  if (bookingSubmitInProgress) return;
  bookingSubmitInProgress = true;
  const submitButton = els.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Saving...";
  try {
    const data = Object.fromEntries(new FormData(els.form).entries());
    const vin = data.chassisNumber.trim().toUpperCase();
    const exists = state.bookings.some((booking) => booking.chassisNumber === vin);
    const saved = await persistBooking({ id: String(Date.now()), ...data, chassisNumber: vin, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const savedIndex = state.bookings.findIndex((booking) => booking.id === saved.id);
    if (savedIndex === -1) state.bookings.push(saved);
    else state.bookings[savedIndex] = saved;
    state.lastRemoteSignature = bookingsSignature(state.bookings);
    els.form.reset();
    els.form.elements.inquiryDate.value = todayKey();
    els.form.elements.job.value = "Service";
    els.formMessage.textContent = exists ? "Saved under existing VIN history." : "Booking saved.";
    render();
    showView("dashboard");
  } finally {
    bookingSubmitInProgress = false;
    submitButton.disabled = false;
    submitButton.textContent = "Save booking";
  }
}

function showVinWarning() {
  const vin = els.form.elements.chassisNumber.value.trim().toUpperCase();
  const matches = state.bookings.filter((booking) => booking.chassisNumber === vin);
  els.vinWarning.hidden = !matches.length;
  els.vinWarning.innerHTML = matches.length ? `<strong>Warning: VIN already exists.</strong><br>${matches.map((booking) => `${prettyDate(booking.bookingDate)} ${prettyTime(booking.bookingTime)} | ${escapeHtml(booking.customerName)}`).join("<br>")}` : "";
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function exportBookings() {
  if (apiMode) {
    location.href = "/api/export.csv";
    return;
  }
  const cols = ["id", "inquiryDate", "customerName", "contactNumber", "chassisNumber", "registrationNumber", "job", "serviceAdvisor", "bookingDate", "bookingTime", "status", "paymentMode", "remarks", "createdAt", "updatedAt"];
  download("bestune_bookings_master.csv", [cols.join(","), ...state.bookings.map((row) => cols.map((key) => csvEscape(row[key])).join(","))].join("\n"));
}

function exportVins() {
  const cols = ["chassisNumber", "customerName", "contactNumber", "registrationNumber", "totalBookings", "lastBookingDate", "lastStatus", "bookingHistory"];
  const rows = vinMaster(state.bookings).map((vehicle) => ({
    chassisNumber: vehicle.chassisNumber,
    customerName: vehicle.latest.customerName,
    contactNumber: vehicle.latest.contactNumber,
    registrationNumber: vehicle.latest.registrationNumber,
    totalBookings: vehicle.total,
    lastBookingDate: vehicle.latest.bookingDate,
    lastStatus: vehicle.latest.status,
    bookingHistory: vehicle.history.map((booking) => `${booking.bookingDate} ${booking.bookingTime} ${booking.status} ${booking.serviceAdvisor} ${booking.paymentMode || ""} ${booking.remarks || ""}`).join(" | ")
  }));
  download("bestune_vin_master_history.csv", [cols.join(","), ...rows.map((row) => cols.map((key) => csvEscape(row[key])).join(","))].join("\n"));
}

async function load() {
  if (apiMode) {
    state.bookings = await (await fetch("/api/bookings")).json();
    state.lastRemoteSignature = bookingsSignature(state.bookings);
  } else {
    const stored = localStorage.getItem(storageKey);
    state.bookings = stored ? JSON.parse(stored) : [...window.BESTUNE_MASTER_BOOKINGS];
    saveLocal();
  }
  const first = state.bookings.find((booking) => booking.bookingDate);
  if (first) {
    const [year, month] = first.bookingDate.split("-").map(Number);
    state.calendarDate = new Date(year, month - 1, 1);
  }
  render();
  showView(location.hash.replace("#", "") || "dashboard");
  if (!apiMode) setupCloudSync();
  startAutoRefresh();
}

async function loadMasterList() {
  state.bookings = [...window.BESTUNE_MASTER_BOOKINGS];
  if (apiMode) {
    for (const booking of state.bookings) await persistBooking(booking);
    await refreshFromServer({ force: true });
  } else {
    saveLocal();
  }
  els.search.value = "";
  state.selectedDate = "";
  render();
  showView("dashboard");
  alert(`Loaded ${state.bookings.length} records from the master list.`);
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("#prevMonth").addEventListener("click", () => { state.calendarDate.setMonth(state.calendarDate.getMonth() - 1); renderCalendar(); });
$("#nextMonth").addEventListener("click", () => { state.calendarDate.setMonth(state.calendarDate.getMonth() + 1); renderCalendar(); });
els.calendarGrid.addEventListener("click", (event) => {
  const day = event.target.closest(".day");
  if (!day) return;
  state.selectedDate = day.dataset.date;
  renderCalendarList();
  showView("calendar");
});
els.search.addEventListener("input", render);
$("#saveAll").addEventListener("click", () => saveAllRows().catch((error) => alert(error.message)));
$("#refreshData").addEventListener("click", () => manualRefresh().catch((error) => alert(error.message)));
$("#loadMaster").addEventListener("click", () => loadMasterList().catch((error) => alert(error.message)));
$("#exportBookings").addEventListener("click", exportBookings);
$("#exportVins").addEventListener("click", exportVins);
els.form.addEventListener("submit", addBooking);
els.form.elements.inquiryDate.value = todayKey();
els.form.elements.chassisNumber.addEventListener("input", showVinWarning);
els.bookingRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr");
  if (event.target.classList.contains("open-vin")) {
    els.search.value = event.target.dataset.vin;
    render();
    showView("vins");
  }
  if (event.target.classList.contains("save-row")) saveBookingRow(row).catch((error) => alert(error.message));
  if (event.target.classList.contains("delete-row")) deleteBooking(row.dataset.id).catch((error) => alert(error.message));
});
els.bookingRows.addEventListener("change", (event) => {
  if (!event.target.classList.contains("table-input")) return;
  event.target.closest("tr").querySelector(".row-message").textContent = "Unsaved";
});
els.mobileBookingCards.addEventListener("click", (event) => {
  const row = event.target.closest(".mobile-edit-card");
  if (!row) return;
  if (event.target.classList.contains("open-vin")) {
    els.search.value = event.target.dataset.vin;
    render();
    showView("vins");
  }
  if (event.target.classList.contains("save-row")) saveBookingRow(row).catch((error) => alert(error.message));
  if (event.target.classList.contains("delete-row")) deleteBooking(row.dataset.id).catch((error) => alert(error.message));
});
els.mobileBookingCards.addEventListener("change", (event) => {
  if (!event.target.classList.contains("table-input")) return;
  event.target.closest(".mobile-edit-card").querySelector(".row-message").textContent = "Unsaved";
});
els.vinRows.addEventListener("click", async (event) => {
  if (event.target.classList.contains("delete-vin")) {
    deleteVin(event.target.dataset.vin).catch((error) => alert(error.message));
    return;
  }
  if (event.target.classList.contains("delete-history-row")) {
    deleteBooking(event.target.closest(".history-row").dataset.id).catch((error) => alert(error.message));
    return;
  }
  if (!event.target.classList.contains("save-remarks")) return;
  const row = event.target.closest(".history-row");
  const booking = state.bookings.find((item) => item.id === row.dataset.id);
  booking.remarks = row.querySelector(".remarks-input").value.trim();
  booking.updatedAt = new Date().toISOString();
  const saved = await persistBooking(booking);
  const index = state.bookings.findIndex((item) => item.id === saved.id);
  if (index !== -1) state.bookings[index] = saved;
  state.lastRemoteSignature = bookingsSignature(state.bookings);
  row.querySelector(".remarks-message").textContent = "Saved";
  render();
  showView("vins");
});

load();

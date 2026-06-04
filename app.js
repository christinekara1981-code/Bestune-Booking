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

const API = "https://api.mail.tm";
const POLL_MS = 7000;
const STORAGE_KEY = "yahavtemp_session_v1";

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  emailAddress: document.querySelector("#emailAddress"),
  mailboxBadge: document.querySelector("#mailboxBadge"),
  createBtn: document.querySelector("#createBtn"),
  copyBtn: document.querySelector("#copyBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  refreshIcon: document.querySelector("#refreshIcon"),
  deleteAccountBtn: document.querySelector("#deleteAccountBtn"),
  customUsername: document.querySelector("#customUsername"),
  domainPreview: document.querySelector("#domainPreview"),
  inboxMeta: document.querySelector("#inboxMeta"),
  messageCount: document.querySelector("#messageCount"),
  inboxEmpty: document.querySelector("#inboxEmpty"),
  messageList: document.querySelector("#messageList"),
  readerEmpty: document.querySelector("#readerEmpty"),
  readerContent: document.querySelector("#readerContent"),
  messageSubject: document.querySelector("#messageSubject"),
  messageSender: document.querySelector("#messageSender"),
  messageSenderAddress: document.querySelector("#messageSenderAddress"),
  messageDate: document.querySelector("#messageDate"),
  senderAvatar: document.querySelector("#senderAvatar"),
  messageBody: document.querySelector("#messageBody"),
  verificationBox: document.querySelector("#verificationBox"),
  verificationCode: document.querySelector("#verificationCode"),
  copyCodeBtn: document.querySelector("#copyCodeBtn"),
  deleteMessageBtn: document.querySelector("#deleteMessageBtn"),
  backBtn: document.querySelector("#backBtn"),
  themeBtn: document.querySelector("#themeBtn"),
  toast: document.querySelector("#toast"),
};

let state = {
  domain: "",
  accountId: "",
  address: "",
  password: "",
  token: "",
  messages: [],
  selectedMessageId: "",
  poller: null,
  loading: false,
};

function toast(message, type = "ok") {
  els.toast.textContent = message;
  els.toast.className = `toast ${type === "error" ? "error" : ""} show`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.className = "toast";
  }, 2600);
}

function setApiStatus(ok, text) {
  els.apiStatus.classList.toggle("online", ok === true);
  els.apiStatus.classList.toggle("offline", ok === false);
  els.apiStatus.querySelector("span").textContent = text;
}

function setBusy(busy) {
  state.loading = busy;
  els.createBtn.disabled = busy;
  if (busy) els.refreshIcon.classList.add("spin");
  else els.refreshIcon.classList.remove("spin");
}

function randomString(length = 14) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => chars[n % chars.length]).join("");
}

function normalizeUsername(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
}

function randomUsername() {
  return `temp${Date.now().toString(36)}${randomString(5)}`;
}

function saveSession() {
  if (!state.accountId || !state.address || !state.password) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    accountId: state.accountId,
    address: state.address,
    password: state.password,
    token: state.token,
    domain: state.domain,
  }));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function updateMailboxUI() {
  const active = Boolean(state.address);
  els.emailAddress.textContent = active ? state.address : "לא נוצרה תיבה";
  els.copyBtn.disabled = !active;
  els.refreshBtn.disabled = !active;
  els.deleteAccountBtn.disabled = !active;
  els.mailboxBadge.textContent = active ? "LIVE" : "OFFLINE";
  els.mailboxBadge.classList.toggle("live", active);
  els.inboxMeta.textContent = active
    ? "מתרענן אוטומטית כל 7 שניות"
    : "צור תיבה כדי להתחיל";
}

async function apiFetch(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);

  const response = await fetch(`${API}${path}`, { ...options, headers });

  if (response.status === 401 && retry && state.address && state.password) {
    const refreshed = await authenticate();
    if (refreshed) return apiFetch(path, options, false);
  }

  return response;
}

async function getDomains() {
  const response = await fetch(`${API}/domains?page=1`);
  if (!response.ok) throw new Error(`Domains error: ${response.status}`);

  const data = await response.json();
  const domains = (data["hydra:member"] || [])
    .filter(d => d.isActive !== false)
    .map(d => d.domain)
    .filter(Boolean);

  if (!domains.length) throw new Error("No active domains");
  state.domain = domains[0];
  els.domainPreview.textContent = `@${state.domain}`;
  setApiStatus(true, "Mail API מחובר");
  return domains;
}

async function authenticate() {
  try {
    const response = await fetch(`${API}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: state.address, password: state.password }),
    });

    if (!response.ok) return false;
    const data = await response.json();
    state.token = data.token || "";
    saveSession();
    return Boolean(state.token);
  } catch {
    return false;
  }
}

async function createMailbox() {
  if (state.loading) return;
  setBusy(true);

  try {
    if (!state.domain) await getDomains();

    let username = normalizeUsername(els.customUsername.value) || randomUsername();
    if (username.length < 3) {
      toast("השם חייב להיות לפחות 3 תווים באנגלית/מספרים.", "error");
      return;
    }

    const password = `${randomString(16)}A9!`;
    let address = `${username}@${state.domain}`;

    let response = await fetch(`${API}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    });

    // If a custom/random address is already taken, retry only when the user did not request a fixed username.
    if (!response.ok && !els.customUsername.value.trim()) {
      username = randomUsername();
      address = `${username}@${state.domain}`;
      response = await fetch(`${API}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
      });
    }

    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.detail || ""; } catch {}
      if (response.status === 422) {
        throw new Error(detail || "השם הזה לא זמין. נסה שם אחר.");
      }
      throw new Error(detail || `לא ניתן ליצור תיבה (${response.status})`);
    }

    const account = await response.json();

    stopPolling();
    state.accountId = account.id;
    state.address = address;
    state.password = password;
    state.token = "";
    state.messages = [];
    state.selectedMessageId = "";

    const authed = await authenticate();
    if (!authed) throw new Error("התיבה נוצרה אך לא הצלחתי להתחבר אליה.");

    saveSession();
    els.customUsername.value = "";
    updateMailboxUI();
    renderMessages([]);
    resetReader();
    startPolling();
    await refreshInbox(true);
    toast("התיבה נוצרה ✓");
  } catch (error) {
    console.error(error);
    toast(error.message || "משהו השתבש ביצירת התיבה.", "error");
  } finally {
    setBusy(false);
  }
}

async function refreshInbox(silent = false) {
  if (!state.token || state.loading) return;
  if (!silent) setBusy(true);

  try {
    const response = await apiFetch("/messages?page=1");
    if (!response.ok) throw new Error(`Inbox error: ${response.status}`);

    const data = await response.json();
    const nextMessages = data["hydra:member"] || [];

    const previousIds = new Set(state.messages.map(m => m.id));
    const newCount = nextMessages.filter(m => !previousIds.has(m.id)).length;

    state.messages = nextMessages;
    renderMessages(nextMessages);

    if (newCount > 0 && previousIds.size > 0) {
      toast(`${newCount} הודעות חדשות הגיעו`);
    }

    setApiStatus(true, "Mail API מחובר");
  } catch (error) {
    console.error(error);
    setApiStatus(false, "שגיאת חיבור");
    if (!silent) toast("לא הצלחתי לרענן את ה-Inbox.", "error");
  } finally {
    if (!silent) setBusy(false);
  }
}

function renderMessages(messages) {
  els.messageCount.textContent = String(messages.length);
  els.inboxEmpty.classList.toggle("hidden", messages.length > 0);
  els.messageList.innerHTML = "";

  for (const message of messages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `message-card ${message.seen ? "" : "unseen"} ${message.id === state.selectedMessageId ? "active" : ""}`;
    button.dataset.id = message.id;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = initials(message.from?.name || message.from?.address || "?");

    const main = document.createElement("div");
    main.className = "message-main";

    const from = document.createElement("div");
    from.className = "message-from";
    from.textContent = message.from?.name || message.from?.address || "Unknown sender";

    const subject = document.createElement("div");
    subject.className = "message-subject";
    subject.textContent = message.subject || "(ללא נושא)";

    const intro = document.createElement("div");
    intro.className = "message-intro";
    intro.textContent = message.intro || "פתח את ההודעה לצפייה";

    main.append(from, subject, intro);

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = formatShortDate(message.createdAt);

    button.append(avatar, main, time);
    button.addEventListener("click", () => openMessage(message.id));
    els.messageList.appendChild(button);
  }
}

async function openMessage(id) {
  state.selectedMessageId = id;
  renderMessages(state.messages);

  try {
    const response = await apiFetch(`/messages/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Message error: ${response.status}`);

    const message = await response.json();

    els.readerEmpty.classList.add("hidden");
    els.readerContent.classList.remove("hidden");
    els.messageSubject.textContent = message.subject || "(ללא נושא)";
    els.messageSender.textContent = message.from?.name || "שולח";
    els.messageSenderAddress.textContent = message.from?.address || "";
    els.senderAvatar.textContent = initials(message.from?.name || message.from?.address || "?");
    els.messageDate.textContent = formatLongDate(message.createdAt);

    const safeText = getSafeText(message);
    els.messageBody.textContent = safeText || "להודעה הזו אין תוכן טקסטואלי להצגה.";

    const code = findVerificationCode(message, safeText);
    if (code) {
      els.verificationCode.textContent = code;
      els.verificationBox.classList.remove("hidden");
    } else {
      els.verificationCode.textContent = "";
      els.verificationBox.classList.add("hidden");
    }

    const cached = state.messages.find(m => m.id === id);
    if (cached) cached.seen = true;
    renderMessages(state.messages);

    // Best-effort mark as read.
    apiFetch(`/messages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ seen: true }),
    }).catch(() => {});
  } catch (error) {
    console.error(error);
    toast("לא הצלחתי לפתוח את ההודעה.", "error");
  }
}

function getSafeText(message) {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }

  const htmlParts = Array.isArray(message.html) ? message.html : [];
  if (htmlParts.length) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlParts.join("\n"), "text/html");
    doc.querySelectorAll("script, style, iframe, object, embed, form, noscript").forEach(el => el.remove());
    return (doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  return "";
}

function findVerificationCode(message, safeText) {
  if (Array.isArray(message.verifications) && message.verifications.length) {
    const raw = String(message.verifications[0]);
    const match = raw.match(/\b[A-Z0-9-]{4,10}\b/i);
    if (match) return match[0];
  }

  const combined = `${message.subject || ""}\n${safeText || ""}`;
  const labeled = combined.match(/(?:code|otp|verification|verify|קוד|אימות)\D{0,25}([A-Z0-9]{4,8})\b/i);
  if (labeled) return labeled[1];

  const numeric = combined.match(/\b(\d{4,8})\b/);
  return numeric ? numeric[1] : "";
}

async function deleteSelectedMessage() {
  const id = state.selectedMessageId;
  if (!id) return;

  try {
    const response = await apiFetch(`/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) throw new Error(`Delete message: ${response.status}`);

    state.messages = state.messages.filter(m => m.id !== id);
    state.selectedMessageId = "";
    renderMessages(state.messages);
    resetReader();
    toast("ההודעה נמחקה");
  } catch (error) {
    console.error(error);
    toast("לא הצלחתי למחוק את ההודעה.", "error");
  }
}

async function deleteMailbox() {
  if (!state.accountId || !state.token) return;

  const okay = confirm("למחוק את התיבה לצמיתות? אי אפשר לשחזר אותה.");
  if (!okay) return;

  try {
    const response = await apiFetch(`/accounts/${encodeURIComponent(state.accountId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) throw new Error(`Delete account: ${response.status}`);
  } catch (error) {
    console.warn(error);
    // Clear local session anyway only after explicit user confirmation.
  }

  stopPolling();
  clearSession();
  state.accountId = "";
  state.address = "";
  state.password = "";
  state.token = "";
  state.messages = [];
  state.selectedMessageId = "";

  updateMailboxUI();
  renderMessages([]);
  resetReader();
  toast("התיבה נמחקה");
}

function resetReader() {
  els.readerContent.classList.add("hidden");
  els.readerEmpty.classList.remove("hidden");
  els.messageBody.textContent = "";
  els.verificationBox.classList.add("hidden");
}

function startPolling() {
  stopPolling();
  state.poller = setInterval(() => refreshInbox(true), POLL_MS);
}

function stopPolling() {
  if (state.poller) clearInterval(state.poller);
  state.poller = null;
}

function initials(value) {
  const cleaned = String(value || "?").trim();
  if (!cleaned) return "?";
  const pieces = cleaned.split(/\s+/);
  if (pieces.length > 1) return (pieces[0][0] + pieces[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function formatShortDate(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const now = new Date();

  if (d.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(d);
  }
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(d);
}

function formatLongDate(dateString) {
  if (!dateString) return "";
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

async function copyText(text, successMessage = "הועתק ✓") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(successMessage);
}

async function restoreSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;

  try {
    const saved = JSON.parse(raw);
    if (!saved.address || !saved.password || !saved.accountId) return false;

    state.accountId = saved.accountId;
    state.address = saved.address;
    state.password = saved.password;
    state.token = saved.token || "";
    state.domain = saved.domain || (saved.address.split("@")[1] || "");

    if (state.domain) els.domainPreview.textContent = `@${state.domain}`;

    // Validate or re-authenticate.
    if (!state.token || !(await validateSession())) {
      const ok = await authenticate();
      if (!ok) throw new Error("Session expired");
    }

    updateMailboxUI();
    startPolling();
    await refreshInbox(true);
    return true;
  } catch {
    clearSession();
    state.accountId = "";
    state.address = "";
    state.password = "";
    state.token = "";
    return false;
  }
}

async function validateSession() {
  try {
    const response = await apiFetch("/me", {}, false);
    return response.ok;
  } catch {
    return false;
  }
}

function toggleTheme() {
  document.documentElement.classList.toggle("light");
  localStorage.setItem("yahavtemp_theme", document.documentElement.classList.contains("light") ? "light" : "dark");
}

function loadTheme() {
  const saved = localStorage.getItem("yahavtemp_theme");
  if (saved === "light") document.documentElement.classList.add("light");
}

els.createBtn.addEventListener("click", createMailbox);
els.copyBtn.addEventListener("click", () => copyText(state.address, "האימייל הועתק ✓"));
els.refreshBtn.addEventListener("click", () => refreshInbox(false));
els.deleteAccountBtn.addEventListener("click", deleteMailbox);
els.deleteMessageBtn.addEventListener("click", deleteSelectedMessage);
els.copyCodeBtn.addEventListener("click", () => copyText(els.verificationCode.textContent, "הקוד הועתק ✓"));
els.backBtn.addEventListener("click", () => {
  state.selectedMessageId = "";
  renderMessages(state.messages);
  resetReader();
});
els.themeBtn.addEventListener("click", toggleTheme);
els.customUsername.addEventListener("input", () => {
  const normalized = normalizeUsername(els.customUsername.value);
  if (els.customUsername.value !== normalized) els.customUsername.value = normalized;
});
els.customUsername.addEventListener("keydown", e => {
  if (e.key === "Enter") createMailbox();
});

window.addEventListener("beforeunload", stopPolling);

(async function init() {
  loadTheme();
  updateMailboxUI();

  try {
    await getDomains();
  } catch (error) {
    console.error(error);
    setApiStatus(false, "API לא זמין כרגע");
    toast("לא הצלחתי להתחבר לשירות המייל.", "error");
  }

  const restored = await restoreSession();
  if (!restored) {
    updateMailboxUI();
    renderMessages([]);
  }
})();

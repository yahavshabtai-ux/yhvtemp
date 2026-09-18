const API = "https://api.tempmailportal.com";
const POLL_MS = 9000;
const STORAGE_KEY = "yahavtemp_session_v2";

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
  closeMessageBtn: document.querySelector("#closeMessageBtn"),
  backBtn: document.querySelector("#backBtn"),
  themeBtn: document.querySelector("#themeBtn"),
  toast: document.querySelector("#toast"),
};

let state = {
  domain: "",
  address: "",
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

function normalizeUsername(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
}

function saveSession() {
  if (!state.address || !state.token) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    address: state.address,
    token: state.token,
    domain: state.domain,
  }));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  // Also remove old Mail.tm session from the first build.
  localStorage.removeItem("yahavtemp_session_v1");
}

function updateMailboxUI() {
  const active = Boolean(state.address && state.token);
  els.emailAddress.textContent = active ? state.address : "לא נוצרה תיבה";
  els.copyBtn.disabled = !active;
  els.refreshBtn.disabled = !active;
  els.deleteAccountBtn.disabled = !active;
  els.mailboxBadge.textContent = active ? "LIVE" : "OFFLINE";
  els.mailboxBadge.classList.toggle("live", active);
  els.inboxMeta.textContent = active
    ? "מתרענן אוטומטית כל 9 שניות"
    : "צור תיבה כדי להתחיל";
}

async function fetchJSON(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (state.token) {
    headers.set("Authorization", `Bearer ${state.token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    let data = null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => null);
    }

    if (!response.ok) {
      const msg = data?.error || `HTTP ${response.status}`;
      const err = new Error(msg);
      err.status = response.status;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function getDomains() {
  const domains = await fetchJSON("/api/domains");
  if (!Array.isArray(domains) || !domains.length) {
    throw new Error("לא נמצאו דומיינים זמינים כרגע.");
  }

  state.domain = domains[0];
  els.domainPreview.textContent = `@${state.domain}`;
  setApiStatus(true, "Mail API מחובר");
  return domains;
}

async function createMailbox() {
  if (state.loading) return;
  setBusy(true);

  try {
    if (!state.domain) await getDomains();

    const typed = els.customUsername.value.trim();
    const username = normalizeUsername(typed);

    if (typed && username.length < 3) {
      throw new Error("השם חייב להיות לפחות 3 תווים באנגלית/מספרים.");
    }

    const body = { domain: state.domain };
    if (username) body.login = username;

    // The API returns { address, token }
    const mailbox = await fetchJSON("/api/inbox", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!mailbox?.address || !mailbox?.token) {
      throw new Error("השרת לא החזיר תיבת מייל תקינה.");
    }

    stopPolling();
    state.address = mailbox.address;
    state.token = mailbox.token;
    state.messages = [];
    state.selectedMessageId = "";

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
    if (error.name === "AbortError") {
      toast("השרת לא הגיב בזמן. נסה שוב.", "error");
    } else {
      toast(error.message || "משהו השתבש ביצירת התיבה.", "error");
    }
  } finally {
    setBusy(false);
  }
}

async function refreshInbox(silent = false) {
  if (!state.token || state.loading) return;
  if (!silent) setBusy(true);

  try {
    const nextMessages = await fetchJSON("/api/messages");

    if (!Array.isArray(nextMessages)) {
      throw new Error("תגובה לא תקינה מה-Inbox.");
    }

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
    if (error.status === 401) {
      stopPolling();
      clearSession();
      state.address = "";
      state.token = "";
      state.messages = [];
      updateMailboxUI();
      renderMessages([]);
      resetReader();
      toast("התיבה כבר לא זמינה. צור תיבה חדשה.", "error");
    } else if (!silent) {
      toast("לא הצלחתי לרענן את ה-Inbox.", "error");
    }
    setApiStatus(false, "שגיאת חיבור");
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
    button.className = `message-card ${message.id === state.selectedMessageId ? "active" : ""}`;
    button.dataset.id = message.id;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = initials(message.fromName || message.from || "?");

    const main = document.createElement("div");
    main.className = "message-main";

    const from = document.createElement("div");
    from.className = "message-from";
    from.textContent = message.fromName || message.from || "Unknown sender";

    const subject = document.createElement("div");
    subject.className = "message-subject";
    subject.textContent = message.subject || "(ללא נושא)";

    const intro = document.createElement("div");
    intro.className = "message-intro";
    intro.textContent = message.intro || "פתח את ההודעה לצפייה";

    main.append(from, subject, intro);

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = formatShortDate(message.date);

    button.append(avatar, main, time);
    button.addEventListener("click", () => openMessage(message.id));
    els.messageList.appendChild(button);
  }
}

async function openMessage(id) {
  state.selectedMessageId = id;
  renderMessages(state.messages);

  try {
    const message = await fetchJSON(`/api/messages/${encodeURIComponent(id)}`);

    els.readerEmpty.classList.add("hidden");
    els.readerContent.classList.remove("hidden");
    els.messageSubject.textContent = message?.subject || "(ללא נושא)";
    els.messageSender.textContent = message?.fromName || "שולח";
    els.messageSenderAddress.textContent = message?.from || "";
    els.senderAvatar.textContent = initials(message?.fromName || message?.from || "?");
    els.messageDate.textContent = formatLongDate(message?.date);

    const safeText = getSafeText(message || {});
    els.messageBody.textContent = safeText || "להודעה הזו אין תוכן טקסטואלי להצגה.";

    const code = findVerificationCode(message || {}, safeText);
    if (code) {
      els.verificationCode.textContent = code;
      els.verificationBox.classList.remove("hidden");
    } else {
      els.verificationCode.textContent = "";
      els.verificationBox.classList.add("hidden");
    }
  } catch (error) {
    console.error(error);
    toast("לא הצלחתי לפתוח את ההודעה.", "error");
  }
}

function getSafeText(message) {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }

  if (typeof message.html === "string" && message.html.trim()) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.html, "text/html");
    doc.querySelectorAll("script, style, iframe, object, embed, form, noscript, img").forEach(el => el.remove());
    return (doc.body?.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return "";
}

function findVerificationCode(message, safeText) {
  const combined = `${message.subject || ""}\n${message.intro || ""}\n${safeText || ""}`;

  const labeled = combined.match(
    /(?:code|otp|verification|verify|passcode|קוד|אימות)\D{0,30}([A-Z0-9]{4,8})\b/i
  );
  if (labeled) return labeled[1];

  const numeric = combined.match(/\b(\d{4,8})\b/);
  return numeric ? numeric[1] : "";
}

async function deleteMailbox() {
  if (!state.token) return;

  const okay = confirm("למחוק את כל ההודעות ולסגור את התיבה בדפדפן הזה?");
  if (!okay) return;

  try {
    await fetchJSON("/api/inbox", { method: "DELETE" });
  } catch (error) {
    console.warn("Remote delete failed:", error);
  }

  stopPolling();
  clearSession();
  state.address = "";
  state.token = "";
  state.messages = [];
  state.selectedMessageId = "";

  updateMailboxUI();
  renderMessages([]);
  resetReader();
  toast("התיבה נוקתה");
}

function resetReader() {
  state.selectedMessageId = "";
  els.readerContent.classList.add("hidden");
  els.readerEmpty.classList.remove("hidden");
  els.messageBody.textContent = "";
  els.verificationBox.classList.add("hidden");
  renderMessages(state.messages);
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
  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

function formatLongDate(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
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
    if (!saved.address || !saved.token) return false;

    state.address = saved.address;
    state.token = saved.token;
    state.domain = saved.domain || (saved.address.split("@")[1] || "");

    if (state.domain) {
      els.domainPreview.textContent = `@${state.domain}`;
    }

    updateMailboxUI();

    // A successful inbox fetch also validates the saved token.
    await refreshInbox(true);

    if (!state.address || !state.token) return false;

    startPolling();
    return true;
  } catch (error) {
    console.warn("Could not restore session:", error);
    clearSession();
    state.address = "";
    state.token = "";
    state.messages = [];
    return false;
  }
}

function toggleTheme() {
  document.documentElement.classList.toggle("light");
  localStorage.setItem(
    "yahavtemp_theme",
    document.documentElement.classList.contains("light") ? "light" : "dark"
  );
}

function loadTheme() {
  const saved = localStorage.getItem("yahavtemp_theme");
  if (saved === "light") document.documentElement.classList.add("light");
}

els.createBtn.addEventListener("click", createMailbox);
els.copyBtn.addEventListener("click", () => copyText(state.address, "האימייל הועתק ✓"));
els.refreshBtn.addEventListener("click", () => refreshInbox(false));
els.deleteAccountBtn.addEventListener("click", deleteMailbox);
els.copyCodeBtn.addEventListener("click", () => copyText(els.verificationCode.textContent, "הקוד הועתק ✓"));
els.closeMessageBtn?.addEventListener("click", resetReader);
els.backBtn.addEventListener("click", resetReader);
els.themeBtn.addEventListener("click", toggleTheme);

els.customUsername.addEventListener("input", () => {
  const normalized = normalizeUsername(els.customUsername.value);
  if (els.customUsername.value !== normalized) els.customUsername.value = normalized;
});

els.customUsername.addEventListener("keydown", event => {
  if (event.key === "Enter") createMailbox();
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
    toast(
      error.name === "AbortError"
        ? "השרת לא הגיב בזמן."
        : "לא הצלחתי להתחבר לשירות המייל.",
      "error"
    );
  }

  const restored = await restoreSession();
  if (!restored) {
    updateMailboxUI();
    renderMessages([]);
  }
})();

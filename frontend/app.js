const API = window.YAHAVMAIL_API;
const TOKEN_KEY = "yahavmail_token_v1";

const $ = s => document.querySelector(s);
const els = {
  status: $("#status"), authCard: $("#authCard"), mailApp: $("#mailApp"),
  registerTab: $("#registerTab"), loginTab: $("#loginTab"), authForm: $("#authForm"),
  username: $("#username"), password: $("#password"), submitBtn: $("#submitBtn"),
  authMsg: $("#authMsg"), domainSuffix: $("#domainSuffix"), myAddress: $("#myAddress"),
  copyBtn: $("#copyBtn"), refreshBtn: $("#refreshBtn"), logoutBtn: $("#logoutBtn"),
  messageList: $("#messageList"), emptyInbox: $("#emptyInbox"), countBadge: $("#countBadge"),
  mailMeta: $("#mailMeta"), emptyReader: $("#emptyReader"), readerContent: $("#readerContent"),
  closeReader: $("#closeReader"), deleteMessage: $("#deleteMessage"), subject: $("#subject"),
  fromName: $("#fromName"), fromAddress: $("#fromAddress"), receivedAt: $("#receivedAt"),
  avatar: $("#avatar"), bodyText: $("#bodyText"), codeBox: $("#codeBox"),
  codeValue: $("#codeValue"), copyCode: $("#copyCode"), toast: $("#toast")
};

let mode = "register";
let token = localStorage.getItem(TOKEN_KEY) || "";
let me = null;
let messages = [];
let selectedId = null;
let poller = null;

function setStatus(ok, text) {
  els.status.textContent = `● ${text}`;
  els.status.className = `status ${ok ? "ok" : "bad"}`;
}
function toast(text, error=false) {
  els.toast.textContent = text;
  els.toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(()=>els.toast.className="toast",2400);
}
function setMode(next) {
  mode = next;
  els.registerTab.classList.toggle("active", next==="register");
  els.loginTab.classList.toggle("active", next==="login");
  els.submitBtn.textContent = next==="register" ? "צור חשבון" : "התחבר";
  els.password.autocomplete = next==="register" ? "new-password" : "current-password";
  els.authMsg.textContent = "";
}
function normalizeUsername(v) {
  return v.trim().toLowerCase().replace(/[^a-z0-9._-]/g,"").slice(0,30);
}
function headers() {
  const h = {"Content-Type":"application/json"};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
async function request(path, opts={}) {
  const res = await fetch(`${API}${path}`, {
    ...opts, headers: {...headers(), ...(opts.headers||{})}, cache:"no-store"
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
async function loadConfig() {
  const data = await request("/api/config");
  els.domainSuffix.textContent = `@${data.domain}`;
  setStatus(true, "השרת מחובר");
}
async function authSubmit(e) {
  e.preventDefault();
  els.authMsg.className = "msg";
  els.authMsg.textContent = "רגע...";
  els.submitBtn.disabled = true;
  try {
    const username = normalizeUsername(els.username.value);
    const password = els.password.value;
    const data = await request(`/api/${mode}`, {
      method:"POST", body:JSON.stringify({username,password})
    });
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    els.password.value = "";
    await loadMe();
    toast(mode==="register" ? "החשבון נוצר ✓" : "התחברת ✓");
  } catch (e) {
    els.authMsg.className = "msg error";
    els.authMsg.textContent = e.message;
  } finally {
    els.submitBtn.disabled = false;
  }
}
async function loadMe() {
  if (!token) return showAuth();
  try {
    me = await request("/api/me");
    els.authCard.classList.add("hidden");
    els.mailApp.classList.remove("hidden");
    els.myAddress.textContent = me.address;
    await refreshInbox();
    startPoll();
  } catch(e) {
    if (e.status===401) logout(false);
    else toast(e.message,true);
  }
}
function showAuth() {
  els.authCard.classList.remove("hidden");
  els.mailApp.classList.add("hidden");
}
async function refreshInbox() {
  try {
    const data = await request("/api/messages");
    messages = data.messages || [];
    renderMessages();
    setStatus(true,"השרת מחובר");
  } catch(e) {
    if (e.status===401) logout(false);
    else setStatus(false,"שגיאת חיבור");
  }
}
function renderMessages() {
  els.messageList.innerHTML = "";
  els.countBadge.textContent = String(messages.length);
  els.mailMeta.textContent = `${messages.length} הודעות`;
  els.emptyInbox.classList.toggle("hidden", messages.length>0);
  for (const m of messages) {
    const b = document.createElement("button");
    b.className = `message${selectedId===m.id ? " active":""}`;
    b.innerHTML = `
      <div class="avatar">${esc(initials(m.from_name || m.from_addr || "?"))}</div>
      <div class="message-main">
        <div class="sender">${esc(m.from_name || m.from_addr || "Unknown")}</div>
        <div class="subject-line">${esc(m.subject || "(ללא נושא)")}</div>
        <div class="intro">${esc(m.preview || "")}</div>
      </div>
      <div class="time">${esc(shortDate(m.received_at))}</div>`;
    b.addEventListener("click", ()=>openMessage(m.id));
    els.messageList.appendChild(b);
  }
}
async function openMessage(id) {
  try {
    selectedId = id;
    renderMessages();
    const m = await request(`/api/messages/${encodeURIComponent(id)}`);
    els.emptyReader.classList.add("hidden");
    els.readerContent.classList.remove("hidden");
    els.subject.textContent = m.subject || "(ללא נושא)";
    els.fromName.textContent = m.from_name || "שולח";
    els.fromAddress.textContent = m.from_addr || "";
    els.receivedAt.textContent = longDate(m.received_at);
    els.avatar.textContent = initials(m.from_name || m.from_addr || "?");
    els.bodyText.textContent = m.text_body || stripHtml(m.html_body || "") || "אין תוכן טקסטואלי להצגה.";
    const code = findCode(`${m.subject||""}\n${m.text_body||""}`);
    els.codeBox.classList.toggle("hidden", !code);
    els.codeValue.textContent = code || "";
  } catch(e) { toast(e.message,true); }
}
function closeReader() {
  selectedId = null;
  els.readerContent.classList.add("hidden");
  els.emptyReader.classList.remove("hidden");
  renderMessages();
}
async function deleteSelected() {
  if (!selectedId || !confirm("למחוק את ההודעה?")) return;
  try {
    await request(`/api/messages/${encodeURIComponent(selectedId)}`,{method:"DELETE"});
    closeReader();
    await refreshInbox();
    toast("ההודעה נמחקה");
  } catch(e){toast(e.message,true)}
}
function logout(show=true) {
  token = "";
  me = null;
  messages = [];
  selectedId = null;
  localStorage.removeItem(TOKEN_KEY);
  stopPoll();
  showAuth();
  closeReader();
  if (show) toast("התנתקת");
}
function startPoll(){stopPoll();poller=setInterval(refreshInbox,10000)}
function stopPoll(){if(poller)clearInterval(poller);poller=null}
function initials(v){v=String(v||"?").trim();const p=v.split(/\s+/);return (p.length>1?p[0][0]+p[1][0]:v.slice(0,2)).toUpperCase()}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function shortDate(v){const d=new Date(v);if(Number.isNaN(d.getTime()))return "";const n=new Date();return d.toDateString()===n.toDateString()?d.toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"}):d.toLocaleDateString("he-IL",{day:"2-digit",month:"2-digit"})}
function longDate(v){const d=new Date(v);return Number.isNaN(d.getTime())?"":d.toLocaleString("he-IL",{dateStyle:"medium",timeStyle:"short"})}
function stripHtml(html){const d=new DOMParser().parseFromString(html,"text/html");d.querySelectorAll("script,style,iframe,img,object,embed,form").forEach(x=>x.remove());return (d.body?.textContent||"").replace(/\n{3,}/g,"\n\n").trim()}
function findCode(s){const a=s.match(/(?:code|otp|verification|verify|קוד|אימות)\D{0,30}([A-Z0-9]{4,8})\b/i);if(a)return a[1];const b=s.match(/\b(\d{4,8})\b/);return b?b[1]:""}
async function copy(v,msg){await navigator.clipboard.writeText(v);toast(msg)}

els.registerTab.onclick=()=>setMode("register");
els.loginTab.onclick=()=>setMode("login");
els.authForm.addEventListener("submit",authSubmit);
els.username.addEventListener("input",()=>els.username.value=normalizeUsername(els.username.value));
els.copyBtn.onclick=()=>me&&copy(me.address,"האימייל הועתק ✓");
els.refreshBtn.onclick=refreshInbox;
els.logoutBtn.onclick=()=>logout(true);
els.closeReader.onclick=closeReader;
els.deleteMessage.onclick=deleteSelected;
els.copyCode.onclick=()=>copy(els.codeValue.textContent,"הקוד הועתק ✓");
window.addEventListener("beforeunload",stopPoll);

(async()=>{
  try {
    await loadConfig();
    if (token) await loadMe(); else showAuth();
  } catch(e) {
    setStatus(false,"השרת לא מוגדר");
    els.authMsg.className="msg error";
    els.authMsg.textContent="עדכן את config.js לכתובת ה-Worker שלך.";
  }
})();

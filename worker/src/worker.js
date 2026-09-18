import PostalMime from "postal-mime";

const SESSION_DAYS = 30;
const MAX_ACCOUNTS_PER_IP_PER_DAY = 3;
const MAX_MAIL_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404, cors);
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        return json({ domain: env.MAIL_DOMAIN }, 200, cors);
      }

      if (request.method === "POST" && url.pathname === "/api/register") {
        return await register(request, env, cors);
      }

      if (request.method === "POST" && url.pathname === "/api/login") {
        return await login(request, env, cors);
      }

      const user = await authenticate(request, env);
      if (!user) return json({ error: "לא מחובר" }, 401, cors);

      if (request.method === "GET" && url.pathname === "/api/me") {
        return json({ id: user.id, username: user.username, address: `${user.username}@${env.MAIL_DOMAIN}` }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/api/messages") {
        const rows = await env.DB.prepare(`
          SELECT id, from_addr, from_name, subject, preview, received_at
          FROM messages WHERE account_id=? ORDER BY received_at DESC LIMIT 100
        `).bind(user.id).all();
        return json({ messages: rows.results || [] }, 200, cors);
      }

      const m = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
      if (m && request.method === "GET") {
        const row = await env.DB.prepare(`
          SELECT id, from_addr, from_name, subject, text_body, html_body, received_at
          FROM messages WHERE id=? AND account_id=?
        `).bind(decodeURIComponent(m[1]), user.id).first();
        if (!row) return json({ error: "הודעה לא נמצאה" }, 404, cors);
        return json(row, 200, cors);
      }

      if (m && request.method === "DELETE") {
        await env.DB.prepare(`DELETE FROM messages WHERE id=? AND account_id=?`)
          .bind(decodeURIComponent(m[1]), user.id).run();
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: "שגיאת שרת" }, 500, cors);
    }
  },

  async email(message, env) {
    try {
      if (!env.MAIL_DOMAIN) {
        message.setReject("Mail domain is not configured");
        return;
      }

      if (message.rawSize > MAX_MAIL_BYTES) {
        message.setReject("Message too large");
        return;
      }

      const rcpt = String(message.to || "").toLowerCase();
      const at = rcpt.lastIndexOf("@");
      if (at <= 0) {
        message.setReject("Invalid recipient");
        return;
      }

      let local = rcpt.slice(0, at);
      const domain = rcpt.slice(at + 1);
      if (domain !== String(env.MAIL_DOMAIN).toLowerCase()) {
        message.setReject("Wrong domain");
        return;
      }

      // Optional plus-addressing: user+tag@domain -> user@domain
      if (local.includes("+")) local = local.split("+")[0];
      local = normalizeUsername(local);
      if (!local) {
        message.setReject("Invalid mailbox");
        return;
      }

      const account = await env.DB.prepare(`SELECT id FROM accounts WHERE username=?`)
        .bind(local).first();
      if (!account) {
        message.setReject("Mailbox does not exist");
        return;
      }

      const parsed = await PostalMime.parse(message.raw);
      const fromAddr = parsed.from?.address || message.from || "";
      const fromName = parsed.from?.name || "";
      const subject = parsed.subject || "(ללא נושא)";
      const text = (parsed.text || "").slice(0, 500_000);
      const html = (parsed.html || "").slice(0, 800_000);
      const preview = makePreview(text || stripHtmlServer(html));
      const id = crypto.randomUUID();
      const receivedAt = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO messages
          (id, account_id, from_addr, from_name, subject, preview, text_body, html_body, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, account.id, fromAddr.slice(0,320), fromName.slice(0,200),
        subject.slice(0,500), preview, text, html, receivedAt
      ).run();
    } catch (err) {
      console.error("email handler error", err);
      message.setReject("Mailbox processing error");
    }
  }
};

async function register(request, env, cors) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");

  if (!username || username.length < 3) {
    return json({ error: "שם המשתמש חייב להיות 3–30 תווים באנגלית/מספרים" }, 400, cors);
  }
  if (password.length < 8 || password.length > 128) {
    return json({ error: "הסיסמה חייבת להיות 8–128 תווים" }, 400, cors);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256Hex(`${env.RATE_LIMIT_SALT || "change-me"}:${ip}`);

  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS c FROM signup_events
    WHERE ip_hash=? AND created_at >= datetime('now','-1 day')
  `).bind(ipHash).first();

  if (Number(recent?.c || 0) >= MAX_ACCOUNTS_PER_IP_PER_DAY) {
    return json({ error: "הגעת למגבלת יצירת החשבונות להיום" }, 429, cors);
  }

  const exists = await env.DB.prepare(`SELECT id FROM accounts WHERE username=?`).bind(username).first();
  if (exists) return json({ error: "שם המשתמש כבר תפוס" }, 409, cors);

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await pbkdf2(password, saltBytes);

  let result;
  try {
    result = await env.DB.prepare(`
      INSERT INTO accounts (username,password_hash,salt,created_at) VALUES (?,?,?,?)
    `).bind(username, hash, salt, new Date().toISOString()).run();
  } catch (e) {
    if (String(e).toLowerCase().includes("unique")) {
      return json({ error: "שם המשתמש כבר תפוס" }, 409, cors);
    }
    throw e;
  }

  const accountId = result.meta.last_row_id;
  await env.DB.prepare(`INSERT INTO signup_events (ip_hash,created_at) VALUES (?,?)`)
    .bind(ipHash, new Date().toISOString()).run();

  const token = await createSession(accountId, env);
  return json({ token, address: `${username}@${env.MAIL_DOMAIN}` }, 201, cors);
}

async function login(request, env, cors) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");

  const account = await env.DB.prepare(`
    SELECT id, username, password_hash, salt FROM accounts WHERE username=?
  `).bind(username).first();

  if (!account) return json({ error: "שם משתמש או סיסמה לא נכונים" }, 401, cors);

  const saltBytes = base64UrlToBytes(account.salt);
  const hash = await pbkdf2(password, saltBytes);
  if (!timingSafeEqual(hash, account.password_hash)) {
    return json({ error: "שם משתמש או סיסמה לא נכונים" }, 401, cors);
  }

  const token = await createSession(account.id, env);
  return json({ token, address: `${account.username}@${env.MAIL_DOMAIN}` }, 200, cors);
}

async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`
    SELECT a.id, a.username
    FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')
  `).bind(tokenHash).first();

  return row || null;
}

async function createSession(accountId, env) {
  // Opportunistic cleanup.
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(bytes);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (token_hash,account_id,expires_at,created_at)
    VALUES (?,?,?,?)
  `).bind(tokenHash, accountId, expires, new Date().toISOString()).run();

  return token;
}

async function pbkdf2(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name:"PBKDF2", salt:saltBytes, iterations:150000, hash:"SHA-256" },
    keyMaterial, 256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function timingSafeEqual(a,b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i=0;i<a.length;i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function normalizeUsername(v) {
  return String(v || "").trim().toLowerCase()
    .replace(/[^a-z0-9._-]/g,"")
    .replace(/^[._-]+|[._-]+$/g,"")
    .slice(0,30);
}

function makePreview(text) {
  return String(text || "").replace(/\s+/g," ").trim().slice(0,180);
}

function stripHtmlServer(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/\s+/g," ")
    .trim();
}

function corsHeaders(origin, env) {
  const allowed = String(env.FRONTEND_ORIGIN || "").replace(/\/$/,"");
  const ok = !allowed || allowed === "*" || origin === allowed;
  return {
    "Access-Control-Allow-Origin": ok ? (allowed === "*" ? "*" : (origin || allowed)) : allowed,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Vary": "Origin"
  };
}

function json(data,status,cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...cors }
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

function bytesToBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function base64UrlToBytes(s) {
  s = String(s).replace(/-/g,"+").replace(/_/g,"/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, c=>c.charCodeAt(0));
}

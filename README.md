# YahavMail — permanent receiving mailbox

This project turns the temporary-mail demo into a **real, persistent receiving mailbox service** on a domain you own.

A user can:
- create a permanent `username@yourdomain.com` account,
- log in later with a password,
- receive real Internet email,
- read messages in the web inbox,
- delete messages,
- copy verification codes detected in message text.

## Architecture

- Frontend: static HTML/CSS/JS — can stay on GitHub Pages.
- Backend/API: Cloudflare Worker.
- Database: Cloudflare D1.
- Inbound mail: Cloudflare Email Routing -> catch-all -> Worker.
- MIME parsing: `postal-mime`.
- Passwords: PBKDF2-SHA256 with per-user salts.
- Sessions: random bearer tokens stored as SHA-256 hashes.
- Basic anti-abuse: max 3 account creations per IP hash per 24 hours.
- HTML email is stored, but the frontend displays safe text rather than rendering remote content.

## Important

This is a real receiving-mail system, but it is **not a full Proton/Tuta replacement**:
- It does not include outbound user-to-user sending.
- It does not include end-to-end encryption.
- Deliverability to/from any specific platform is never guaranteed; a new/custom domain can still be filtered by another service.

Cloudflare Email Routing requires your domain to use Cloudflare DNS.

As of 2026, Cloudflare Email Routing is available on Free and Paid plans. Cloudflare's general outbound Email Sending feature is separate and available on the Workers Paid plan.

## 1. Buy/use a domain

Example:
`yahavmail.com`

You cannot create globally routable addresses such as `user@yahavmail.com` unless you control that domain and its DNS/MX records.

## 2. Add the domain to Cloudflare

Move the domain's DNS to Cloudflare.

In Cloudflare:
Compute -> Email Service -> Email Routing -> Onboard Domain

Cloudflare adds the required mail records.

## 3. Create D1 database

In a terminal inside `worker/`:

```bash
npm install
npx wrangler login
npx wrangler d1 create yahavmail
```

Copy the returned database ID into `wrangler.toml`.

Then run the schema:

```bash
npx wrangler d1 execute yahavmail --remote --file=./schema.sql
```

## 4. Edit worker/wrangler.toml

Set:

```toml
MAIL_DOMAIN = "yourdomain.com"
FRONTEND_ORIGIN = "https://YOUR-GITHUB-USERNAME.github.io"
RATE_LIMIT_SALT = "a-long-random-secret"
```

Set the D1 `database_id` too.

## 5. Deploy the Worker

```bash
npx wrangler deploy
```

Wrangler will print a URL such as:

```text
https://yahavmail-api.YOUR-SUBDOMAIN.workers.dev
```

## 6. Route all inbound email to the Worker

Cloudflare Dashboard:
Compute -> Email Service -> Email Routing -> Routing Rules

Enable the **Catch-all** rule and choose the `yahavmail-api` Worker as its action.

The Worker rejects mailboxes that do not correspond to a registered account.

## 7. Connect the frontend

Edit:

`frontend/config.js`

and replace:

```js
window.YAHAVMAIL_API = "https://REPLACE-WITH-YOUR-WORKER.workers.dev";
```

with your deployed Worker URL.

Upload everything in `frontend/` to your GitHub Pages repository.

## 8. Test

1. Create a user in the site, for example `test`.
2. The site will show `test@yourdomain.com`.
3. Send a normal email from Gmail/Outlook to that address.
4. It should appear in the inbox.

## Security / production notes

Before opening registration publicly, consider adding:
- Cloudflare Turnstile,
- stronger per-IP and per-account rate limiting,
- account recovery,
- spam filtering,
- quotas,
- encrypted mailbox storage,
- abuse reporting,
- monitoring and backups.

Do not use this project for spam, deceptive account creation, or attempts to bypass another service's restrictions.

# Setup checklist (what is left)

## 0. Restart the backend (required)
Your running server was started before the latest changes. Stop it (Ctrl+C) and start again with
`npm run dev` (from the project root) — it restarts itself when files change. Log in again afterwards.

## 1. Cloudflare R2 (file storage, 9.5 GB cap)
1. dash.cloudflare.com → sign up / log in → **R2 Object Storage** → enable R2 (free plan needs a card on file; 10 GB storage free).
2. **Create bucket** → name e.g. `olympiad-files` → location Automatic.
3. Bucket → **Settings → Public access**:
   - quick start: enable **R2.dev subdomain** → copy the `https://pub-xxxx.r2.dev` address
   - production (recommended): **Custom domain** e.g. `files.your-domain.org` (domain must be on Cloudflare)
4. Bucket → **Settings → CORS policy** → add:
   ```json
   [{ "AllowedOrigins": ["http://localhost:5173", "https://your-domain.org"],
      "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
5. R2 overview → **Manage R2 API Tokens → Create API token** → permission **Object Read & Write**, apply to **this bucket only** → create → copy **Access Key ID** and **Secret Access Key** (shown once).
6. Copy your **Account ID** (R2 overview page, right side).
7. Put in `backend/.env` (and `backend/.env.production` for the live server):
   ```
   R2_ACCOUNT_ID=<account id>
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret access key>
   R2_BUCKET=olympiad-files
   R2_PUBLIC_URL=https://pub-xxxx.r2.dev      # or https://files.your-domain.org
   ```
8. `npm run check --prefix backend` → restart backend.
9. Check: Admin → Dashboard → **File storage** shows "0.00 GB of 9.50 GB" (not "Local disk") → press **Run now** on "Recount Cloudflare storage" → no error.
   Upload an image in a news item → its link starts with your R2 public address and opens in the browser.

## 2. Email notifications (Brevo, free 300/day)
1. brevo.com → sign up (free, no card).
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain** → add the DNS records Brevo shows (DKIM, Brevo code, DMARC) at your domain provider → wait until all show **Verified**.
   (Without your own domain you can verify a single sender address instead, but mail is more likely to go to spam.)
3. **Senders → Add sender** → e.g. `updates@your-domain.org`.
4. **SMTP & API → SMTP tab** → copy **Login** → **Generate a new SMTP key** → copy it (this is NOT the API key).
5. In `backend/.env`: comment out the 4 Ethereal `SMTP_*` lines and uncomment/fill the Brevo block:
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=<Login>
   SMTP_PASS=<SMTP key>
   EMAIL_FROM="Mathematical Olympiad <updates@your-domain.org>"
   EMAIL_REPLY_TO=<optional: your school/contact inbox>
   NOTIFY_DAILY_LIMIT=300
   ```
   Same values in `backend/.env.production` (host/port/limit are already there).
6. `npm run check --prefix backend` → restart backend.
7. Check:
   - Dashboard → **Email notifications** shows "Brevo", your From address, "Background sender: running".
   - Website → **Profile** → enter your own email → you receive "Confirm your Mathematical Olympiad updates" → click **Confirm my email** → **Yes, confirm**.
   - Admin → Add news → tick **Send email notification** → Publish → within ~10 s you receive "New Mathematical Olympiad update: …" (check spam the first time).
   - Click **Unsubscribe** in that email → confirm → Admin → Users shows you as inactive.
   - Brevo → **Transactional → Logs** shows the emails as delivered.

## 3. Before going live
- Deploy backend + frontend; set real `API_URL`, `CLIENT_URL`, `TRUST_PROXY=1` in `backend/.env.production` (saved as `.env` on the server) and `VITE_API_BASE` in the frontend production env.
- Run `npm run check` and `npm run db:indexes` in `backend` on the server.
- Atlas → Network Access: allow the server's IP.
- Optional: contact email/phone in `frontend/.env` (`VITE_CONTACT_EMAIL`, `VITE_CONTACT_PHONE`).
- Recommended: a 10+ character admin password (Admin → Admins & Password).

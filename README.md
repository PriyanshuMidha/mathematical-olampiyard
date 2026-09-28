# Mathematical Olympiad CMS

Full-stack CMS website for Mathematical Olympiad updates.

## Features

- Public Mathematical Olympiad website
- Latest/current news pages
- Full news detail pages
- Results and resources pages
- Email subscription form
- Admin-only CMS login
- Admin dashboard
- Add current news and detailed pages
- Manage news, results, resources, subscribers, categories and levels
- MongoDB + Mongoose backend
- Link support for external notices and downloads
- File upload support in the backend API

## Stack

- Frontend: React, Vite, React Router, CSS
- Backend: Node.js, Express, MongoDB, Mongoose
- Auth: JWT admin login
- Email: Nodemailer-ready
- Uploads: Multer local storage

## Architecture

Backend is split into feature modules (`backend/src/modules/*`) on top of shared `core/` helpers, built to run as several stateless instances. See `FLOW.md` for the full frontend + backend flow, API reference, security notes and how to add a feature.

Useful backend scripts: `npm run check` (validate .env), `npm run seed`, `npm run db:indexes` (run on deploy).

## Setup

```bash
cd mathematical-olympiad-cms
npm run install:all
cp backend/.env.example backend/.env
```

Edit `backend/.env` if needed:

```txt
MONGODB_URI=mongodb://127.0.0.1:27017/mathematical-olympiad-cms
JWT_SECRET=<output of: openssl rand -hex 32>
ADMIN_EMAIL=<your admin username or email>
ADMIN_PASSWORD=<at least 10 characters>
```

Create the admin account and default levels/categories (no sample content; safe to re-run):

```bash
npm run seed --prefix backend
```

Run backend and frontend together:

```bash
npm run dev
```

Frontend:

```txt
http://localhost:5173
```

Backend:

```txt
http://localhost:5001/api
```

Admin login: `http://localhost:5173/admin/login` with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set before seeding. More admins and password changes: Admin → **Admins & Password**.

Tests (backend, needs a MongoDB to create throwaway databases in):

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test --prefix backend
```

## Important Routes

Public:

- `/`
- `/news`
- `/news/:slug`
- `/results`
- `/resources`
- `/about`
- `/contact`

Admin:

- `/admin/login`
- `/admin`
- `/admin/news/new`
- `/admin/news/:id/edit`
- `/admin/news`
- `/admin/results`
- `/admin/resources`
- `/admin/subscribers`
- `/admin/categories`

## Notes

See `FLOW.md` for the complete frontend + backend flow, API reference and known gaps.


For production, move file uploads to Cloudinary/S3 and use a transactional email provider such as SendGrid, Mailgun or AWS SES.

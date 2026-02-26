# Therapy App Backend

Vercel-ready Node.js backend using TypeScript + Prisma.

## 1) Install

```bash
cd backend
npm install
```

## 2) Configure environment

Create `.env` from `.env.example` and set:
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN` (for local frontend, usually `http://localhost:5173`)

## 3) Initialize Prisma

```bash
npx prisma migrate dev --name init
```

## 4) Run locally (Vercel runtime)

```bash
npm run dev
```

Local endpoints:
- `GET /api/health`
- `GET /api/users/count`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/billing/fake-payment`
- `GET /api/logs?view=active|archive|all`
- `POST /api/logs`
- `PATCH /api/logs/:id`
- `DELETE /api/logs/:id`
- `GET /api/profile`
- `PUT /api/profile`
- `DELETE /api/account`
- `GET /api/sessions`
- `POST /api/sessions`
- `PATCH /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `GET /api/homework`
- `POST /api/homework`
- `PATCH /api/homework/:id`
- `DELETE /api/homework/:id`

## 5) Deploy on Vercel

- Import this repo in Vercel.
- Set **Root Directory** to `backend`.
- Add `DATABASE_URL` in Vercel environment variables.
- Add `JWT_SECRET` in Vercel environment variables.
- Add `CORS_ORIGIN` if frontend is hosted on a different origin.
- Deploy.

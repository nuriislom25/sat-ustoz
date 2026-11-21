# Security policy

## Reporting a problem

If you find a security problem in SAT Ustoz (ustozsat.uz), please **do not open a public GitHub issue**.
Write privately to the owner through the Telegram bot or the support chat on the website, with:

- what you found and where (page or API path),
- the steps to reproduce it,
- what an attacker could do with it.

You will get an answer within a few days. Please give us reasonable time to fix the problem before you tell anyone
else, and do not access, change or delete other people's data while testing.

## Rules for this codebase

- **Secrets live only on the server**: `server/.env` (never committed) or the database settings table
  (keys starting with `_` are never sent to any browser). The website bundle contains no secrets and no
  environment variables; public values come from `/api/config`.
- **Every API route is behind the server's auth gate** (`server/src/index.js`): only the paths in `PUBLIC` and the
  public site/game/practice routes answer guests. Teacher routes use `requireMaster`; staff admins are further limited
  to their sections by `adminGuard` (`server/src/admins.js`). Front-end checks are only for the interface.
- **Ownership is checked on the server** for anything fetched by ID (attempts, mocks, bookings, results).
- **Sessions** are HS256 JWTs signed with `JWT_SECRET`; the algorithm is pinned, tokens expire after 30 days, and
  “Sign out everywhere” / a password change revokes all of them (`token_version`).
- **Passwords** are hashed with bcrypt; weak and published default passwords are refused. Default demo passwords
  only work on `localhost`.
- **Limits**: per-IP request limits, per-account sign-in lockout; the client IP is taken from the proxy's own entry,
  so a forged `X-Forwarded-For` cannot reset them.
- **Headers**: strict Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `nosniff`, no `Access-Control-Allow-Origin: *`.
- **SQL** always uses parameters (`?` placeholders); never build SQL from request values.
- No source maps are published; production error messages are generic.

Before a change that touches sign-in, roles or data access, run:

```bash
npm run test:security --prefix server
```

## Production checklist

- `NODE_ENV=production`, a long random `JWT_SECRET` and `SITE_URL` in `server/.env` on the server.
- HTTPS only (the app sends HSTS); the reverse proxy should pass `X-Forwarded-For` / `X-Forwarded-Proto`.
- If a secret was ever exposed: rotate it, then press “Sign out everywhere” in the teacher panel.

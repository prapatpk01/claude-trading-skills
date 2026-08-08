# Sentinel Investment OS — Railway Production Setup

This app is ready to run on Railway with Supabase as the persistent database.

## Railway service settings

Create a new Railway service from GitHub repository:

- Repository: `prapatpk01/claude-trading-skills`
- Branch: `main`
- Root Directory: `/webapp`
- Config File Path: `/webapp/railway.toml`
- Builder: Railpack (from `railway.toml`)
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Healthcheck path: `/api/system/health`
- Healthcheck timeout: `300`
- Restart policy: `ON_FAILURE`, max 10 retries

Do not use the repository root as the service root. The Next.js application is in `/webapp`. Railway's config-file lookup does not automatically follow the Root Directory for a monorepo, so set the Config File Path explicitly to `/webapp/railway.toml`.

## Required Railway Variables

Set these under Railway → Service → Variables.

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
```

`SUPABASE_SECRET_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_`, never place it in Git, and never expose it to browser code.

The app also accepts these legacy server-only aliases, but `SUPABASE_SECRET_KEY` is preferred:

```env
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SERVICE_KEY=
```

Optional market-data variables:

```env
SEC_USER_AGENT=SentinelInvestmentOS/1.0 (contact: your-email@example.com)
ALPHA_VANTAGE_API_KEY=
FINNHUB_API_KEY=
```

Yahoo Finance remains the default provider and needs no API key.

## Secure write architecture on Railway

Railway uses direct server-side writes:

Browser → Next.js API on Railway → `SUPABASE_SECRET_KEY` → Supabase

The privileged key is read only by the Node.js server. Watchlist and Holdings write routes call the privileged Supabase client when this key exists.

The Vercel OIDC → `sentinel-write` Edge Function path remains in the codebase only as a Vercel fallback. Railway does not depend on Vercel OIDC.

## Production verification

After Railway reports the deployment as active, open:

`https://YOUR_RAILWAY_DOMAIN/api/system/health`

Required result:

```json
{
  "productionReady": true,
  "checks": {
    "serviceRoleConfigured": true,
    "adminKeySource": "SUPABASE_SECRET_KEY",
    "writeAuth": "supabase-secret",
    "serverWritesProtected": true,
    "databaseReachable": true
  }
}
```

Then verify:

1. Add a temporary Watchlist ticker and remove it.
2. Perform a reversible Holdings edit and restore the original value.
3. Re-open `/api/system/health` and confirm `productionReady=true` and `serverWritesProtected=true`.

## Domain

After the service is healthy, generate a Railway domain under Settings → Networking. A custom domain can be added later without changing the Supabase architecture.

## Cost control

For a small private Next.js app, start on the Railway Hobby plan. Configure a usage alert and a hard usage limit in Railway billing settings if desired.

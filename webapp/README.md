# Equity Research Terminal

A web app that turns a **stock ticker** into an institutional-grade equity research
workbook, tracks your **portfolio & watchlist**, and runs a **momentum swing scanner** —
built on Next.js 14 (App Router) + Supabase, with Alpha Vantage & Finnhub as data sources.

## Features

### 1. 🔎 Ticker Analysis → downloadable 6-sheet XLSX
Type a ticker and get a live on-screen brief plus a downloadable Excel workbook with
**live formulas, conditional formatting, and source references**:

| Sheet | Contents |
| --- | --- |
| 1. Executive Summary | Overview, current metrics, blended target price, quick thesis, signal drivers |
| 2. Industry & Competition | Sector, TAM/CAGR inputs, growth drivers, peer table, moat assessment |
| 3. Financials & Earnings | Historical revenue/margins (formula-driven), returns, debt profile, earnings beat/miss |
| 4. Thesis, Catalysts & Risks | Bull/Base/Bear scenarios (probability-weighted), 12-month catalyst timeline, risks |
| 5. 3-Statement Model | 5-year IS / CFS / BS forecast — editable assumption cells recompute the model |
| 6. Valuation & Scenarios | WACC build-up, DCF cash flows, terminal value, **live sensitivity grid**, scenario targets |

The 3-statement model and DCF are **linked with real Excel formulas** — edit the blue
assumption cells (growth, margins, WACC, terminal growth) and every downstream number,
including the sensitivity table, recalculates in Excel.

### 2. 💼 Portfolio & Watchlist
Record holdings (shares, cost basis, personal target, rolling thesis), see live
market value / unrealized P&L, and maintain a watchlist with alert levels and reasons.
Persisted in Supabase; falls back to an in-memory store when Supabase isn't configured.

### 3. 📡 Momentum Swing Scanner
Ranks a universe by a **Momentum-Centric Alpha Score** (Momentum & RS 40% · Volume
Accumulation 25% · Structure & Trend 20% · Catalyst Drift 15%) and returns the top swing
setups for a **7–15 day** horizon with entry range, target (measured-move), stop, and R:R,
plus a market-regime read (SPY vs 20-EMA, realized-vol VIX proxy).

## Getting started

```bash
cd webapp
cp .env.example .env        # add your API keys (see below)
npm install
npm run dev                 # http://localhost:3000
```

### Environment variables (`.env`)
| Var | Purpose | Required |
| --- | --- | --- |
| `ALPHA_VANTAGE_API_KEY` | Fundamentals, statements, daily prices, earnings | Recommended (falls back to `demo` = IBM only) |
| `FINNHUB_API_KEY` | Fallback real-time quote | Optional |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Portfolio/watchlist persistence | Optional (in-memory fallback) |

- Free Alpha Vantage key: <https://www.alphavantage.co/support/#api-key>
- Free Finnhub key: <https://finnhub.io/register>

> ⚠️ Alpha Vantage's free tier is rate-limited (~5 req/min, 25/day). The scanner runs
> sequentially and surfaces rate-limit warnings; use a short custom ticker list for reliability.

### Supabase setup (optional)
1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor** → run [`supabase/schema.sql`](supabase/schema.sql).
3. Put the project URL + service-role key in `.env`.

> The bundled schema uses permissive single-tenant RLS (personal use). For multi-user,
> add a `user_id` column and scope policies to `auth.uid()`.

## Deploy

All XLSX generation and data fetching run in Node.js API routes, so any Node host works.

### Railway (recommended if you already use Railway)
The app lives in the `webapp/` subfolder, so point the service at it:

1. **New → Deploy from GitHub repo** → pick `claude-trading-skills`.
2. Service **Settings → Root Directory = `webapp`** (required — otherwise the build can't find `package.json`).
3. Nixpacks auto-detects Next.js and uses [`webapp/railway.json`](railway.json)
   (`npm ci && npm run build` → `npm run start`). Railway injects `PORT`, which
   `next start` reads automatically — no extra config needed.
4. **Variables** tab → add:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ALPHA_VANTAGE_API_KEY=...
   ```
5. **Settings → Networking → Generate Domain** to get a public URL.

> 💡 Cost: a Next.js web service stays *always-on*, unlike a bot that idles.
> On the Hobby plan ($5 credit/mo) an always-on ~512 MB service can consume most
> of that credit on its own, so running it **alongside** a bot may tip you into
> paid usage. To cut cost, cap memory in service settings or scale to 0 when idle.

### Vercel
Import the repo, set **Root Directory = `webapp`**, add the env vars above, deploy.

## Architecture
```
app/
  page.tsx                 # dashboard shell (3 tabs)
  components/              # AnalyzeTab, PortfolioTab, ScannerTab, format helpers
  api/
    analyze/               # GET ?ticker → full AnalysisResult JSON
    workbook/              # GET ?ticker → .xlsx download (exceljs)
    scan/                  # GET ?tickers → momentum scan
    quote/                 # GET ?tickers → light quotes for portfolio
    portfolio/ watchlist/  # CRUD (Supabase or in-memory)
lib/
  marketData.ts            # Alpha Vantage + Finnhub fetchers + aggregator
  indicators.ts            # RSI, MACD, EMA/SMA, ATR, RS, volume ratios
  analysis.ts              # technicals, momentum score, DCF, signal
  analyze.ts               # buildAnalysis(): assembles the full research payload
  scan.ts                  # market regime + universe scan
  workbook.ts              # 6-sheet exceljs builder (formulas + conditional formatting)
  supabase.ts / store.ts   # persistence + in-memory fallback
supabase/schema.sql        # tables, triggers, RLS
```

## Disclaimer
For research and educational use only. Not investment advice. Data may be delayed or
incomplete depending on provider limits. Always do your own research.

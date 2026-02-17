<p align="center">
	<img src="public/emerald%20logo.svg" alt="Emerald Logo" width="120" />
</p>

Emerald is a Next.js + Tailwind CSS v4 app for experimenting with finance dashboards, bank connections (Plaid), Stripe card linking, and an AI chat assistant.

It ships with:

- A marketing/promo landing page
- Clerk-powered auth flows (sign in / sign up)
- A signed-in dashboard with demo finance KPIs
- Optional real bank connections via Plaid
- Optional card linking via Stripe Elements
- An AI assistant that can answer general questions or query your own finance data

---

## Getting Started

### 1. Install dependencies

```bash
npm install
# or
yarn
```

### 2. Create your `.env.local`

Copy the example file and fill in values from your own accounts:

```bash
cp .env.example .env.local
```

At minimum for local development you should set:

- `DATABASE_URL` – SQLite URL (defaults to `file:./dev.db`)
- Clerk keys (to enable auth)
- Either OpenAI or Hugging Face credentials for the chat assistant

Details for each section are below.

### 3. Set up the database

This project uses Prisma with SQLite by default.

```bash
npx prisma migrate dev
```

This will create `dev.db` at the path from `DATABASE_URL`.

### 4. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

Key routes:

- Home promo: app/page.tsx
- Sign in: app/auth/sign-in/page.tsx
- Sign up: app/auth/sign-up/page.tsx

The UI supports dark mode via system preference. Fonts are loaded with next/font (Geist), and styling uses Tailwind CSS v4 via @tailwindcss/postcss.

---

## Environment Variables

All secrets should live in `.env.local` (never commit a real `.env`). See `.env.example` for a complete reference.

### Core

- `DATABASE_URL` – Prisma connection string (default `file:./dev.db` for SQLite)

### Auth (Clerk)

Configure a Clerk project and add:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` – Clerk frontend key
- `CLERK_SECRET_KEY` – Clerk backend key

Refer to the Clerk Next.js docs for the most up-to-date setup instructions.

### AI Chat Assistant

The floating chat widget lives at app/components/chat-widget.tsx and talks to app/api/chat/route.ts.

Add to `.env.local`:

- `CHAT_PROVIDER` (optional) – `openai` or `huggingface`. If omitted, the server auto-picks based on which API key is present.

OpenAI:

- `OPENAI_API_KEY` – required if you use OpenAI
- `OPENAI_MODEL` (optional) – defaults to `gpt-4o-mini`

Hugging Face:

- `HUGGINGFACE_API_KEY` – required if you use Hugging Face
- `HUGGINGFACE_MODEL` (optional) – defaults to `mistralai/Mistral-7B-Instruct-v0.3`

Some models are gated or disabled on the public Inference API. If you see errors like `Hugging Face error (410)` or `403`, open the model page on Hugging Face, accept the terms if prompted, or switch `HUGGINGFACE_MODEL` to a supported public model.

After configuring an AI provider, run `npm run dev` and open the chat bubble.

### Stripe Card Linking (PCI-safe)

This project uses Stripe Elements (Payment Element + SetupIntents) so raw card numbers never touch your server.

Add to `.env.local`:

- `STRIPE_SECRET_KEY` – required for server routes
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` – required for the client card form

The banking flows use:

- app/api/payments/stripe/setup-intent/route.ts
- app/api/payments/stripe/payment-methods/route.ts

### Plaid / Bank Connections (optional)

If you want real bank data instead of the built-in demo data, configure Plaid and encryption keys defined in lib/server/env.ts:

- `BANK_TOKEN_ENCRYPTION_KEY` – base64-encoded 32-byte key used to encrypt access tokens at rest (required when Plaid is enabled)
- `PLAID_CLIENT_ID` – your Plaid client id
- `PLAID_SECRET` – your Plaid secret
- `PLAID_ENV` – `sandbox`, `development`, or `production` (defaults to `sandbox`)
- `PLAID_REDIRECT_URI` (optional)
- `PLAID_WEBHOOK_URL` (optional)

Without these, Plaid-powered bank linking will be disabled, but the app and demo data still work.

---

## Using Real Finance Data in the AI Assistant

When a user is signed in (via Clerk), the assistant can call internal tools to answer questions like:

- “How much did I spend this month?”
- “What are my recent transactions?”
- “How is my balance trending?”

Available tools (signed-in only):

- `get_finance_snapshot(period)` – KPIs/trends + recent transactions for a period
- `get_recent_transactions(timeframe, limit)` – list of recent transactions (THIS_MONTH, LAST_MONTH, PAST_7_DAYS, etc.)
- `get_spending_summary(timeframe, compareTo?)` – totals + top categories, with optional comparison deltas

If the user is signed out, the assistant falls back to general guidance only.

---

## Tech Stack

- Next.js App Router
- React
- Tailwind CSS v4
- Prisma + SQLite (can be swapped for another provider)
- Clerk (auth)
- Stripe (card vaulting)
- Plaid (bank connections)
- Zod (runtime validation)

---

## Deployment

You can deploy this app to any Next.js-compatible host (e.g. Vercel, Netlify, or your own Node server). Make sure to configure all required environment variables in your hosting provider’s dashboard.

For general guidance, see the official Next.js deployment docs: https://nextjs.org/docs/app/building-your-application/deploying

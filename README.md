# Ekatvam Seva

React + Vite + TypeScript frontend, FastAPI backend, Supabase PostgreSQL/Auth/private Storage, and an AiSensy notification worker. Telugu is the initial language; Telugu, Hindi, and English are selectable without signing in, with browser persistence. All authored UI text and admin event fields have three-language support. Personal consultation notes/responses remain in the language in which they were written; they are not machine-translated.

## Current implementation

- Responsive devotional homepage, service pages, event details, and private dashboards.
- Phone/password registration with SMS verification, password login, OTP login, and OTP-based password reset through Supabase Auth.
- Three roles: one main admin, sub-Ayyagarus, and devotees. Roles come from protected profile records, never editable signup metadata.
- Private Jatakam uploads. Backend decodes and re-encodes images, removes metadata, enforces size/type limits, and authorises short-lived signed reads.
- Automatic assignment to an available sub-Ayyagaru with no active consultation, manual admin reassignment, written responses, and assignment of the next waiting request after completion.
- Three-language event authoring, publishing, capacity-limited free bookings, and printable invitations for confirmed bookings.
- WhatsApp consent preferences, durable notification outbox, and a separately started AiSensy worker with per-language campaign configuration.
- Payments deliberately disabled. Paid requests/bookings remain `awaiting_payment`, do not trigger fulfilment, and do not issue invitations. Pending paid event requests do not reserve seats. There is no fake successful payment path.

Without frontend environment variables, the website runs as a clearly labelled **browser-only demo**. Demo accounts, uploads, consultations, events, and bookings use this browser's storage; no backend is required. These are simulated records, not real announcements, payments, or messages. Live services have not been connected or tested against a real Supabase/AiSensy account.

## Demo accounts — no backend needed

Run the frontend, click **Demo accounts**, and use a one-click account button or enter these credentials in the normal password form:

| Role | Mobile number | Password |
| --- | --- | --- |
| Super admin / Main Ayyagaru | `9000000001` | `Demo@12345` |
| Sub-Ayyagaru | `9000000002` | `Demo@12345` |
| User / Ananya | `9000000003` | `Demo@12345` |
| Additional member / Ravi | `9000000004` | `Demo@12345` |

Demo OTP: **123456**. No SMS is sent. Registration, OTP login, and password reset are simulated locally. Please use sample data, disposable passwords, and sample images only. Demo passwords are stored in browser storage for testing; this is not production authentication.

The demo starts automatically if Supabase credentials are absent. With configured live credentials, visit `/?demo=1` or set `VITE_DEMO_MODE=true` to enter the isolated demo. The demo API never sends a request to FastAPI, Supabase, or AiSensy. Demo sessions are per tab, sample records persist on this browser, and uploaded demo images use IndexedDB. Actual live accounts and records are separate.

Try these flows:

1. Enter the **user demo**, view sample consultations, upload an image, and book a free event to view its invitation. The paid event stays pending and issues no ticket.
2. Switch to the **sub-Ayyagaru demo** and complete the sample assigned consultation. The next waiting free request is assigned automatically. Switch back to the user to see the written response.
3. Enter the **super admin demo** to see all requests, reassign work, add Ravi to the team using `9000000004`, set fees, create events in all three languages, and publish events. WhatsApp notifications appear in the simulated queue but are never sent.
4. Use **Reset demo** in the demo banner to restore the initial accounts, passwords, sample records, and fee. Reset removes uploaded demo images and demo changes on this device, signs out the demo account, and preserves language preferences and unrelated application data.

Payment processing and actual message delivery remain deferred. The default consultation fee is zero only in the demo, so its assignment flow can be explored; changing it to a positive fee makes new requests payment-pending. There is no simulated payment-success button.

## Run the frontend

From this directory on Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173. The PowerShell `.cmd` suffix avoids the execution-policy restriction on npm.ps1.

For live integration, copy `.env.example` to `.env.local` and set the Supabase project URL, its public anon key, and the FastAPI URL. Never put a service-role key or AiSensy API key in a `VITE_` variable. Restart Vite after changing environment files.

```powershell
npm.cmd run build
npm.cmd run preview
```

Production assets are written to `dist/`. Hosting remains planned for AWS; nothing has been deployed or provisioned.

## Set up Supabase

1. Create the project and apply `supabase/migrations/001_initial.sql` once using its SQL editor or your migration tooling. The embedded PostgreSQL tests validate its SQL and business rules; a real project migration is still needed.
2. Enable Phone Auth, enable phone confirmation, and configure an SMS provider. Set SMS OTPs to six digits to match the verification UI. Configure password policy to at least 10 characters. Configure signup/OTP rate limits and abuse controls for deployment.
3. Set the production site URL and allowed redirect URLs. Check SMS delivery for the intended Indian mobile networks.
4. Register and verify the main Ayyagaru through the website. Promote that account through the SQL editor using the actual verified phone number, for example:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and p.phone = '+91YOUR_VERIFIED_NUMBER'
  and u.phone_confirmed_at is not null;
```

The partial unique index allows only one admin. Normal users cannot promote themselves. Sub-Ayyagarus register and verify their phone first; the main admin adds them to the team by mobile number.

5. The admin must explicitly set the consultation fee in Service settings. No real business fee is assumed. A zero fee allows the free assignment workflow to be exercised; positive fees remain pending while payment work is deferred.

Business tables and the Jatakam bucket reject direct browser writes. FastAPI holds the service-role credential and enforces ownership/role checks. Keep the Jatakam bucket private. Images are limited to 10 MB and 20 megapixels, with cleaned images capped at 5000px per side.

## Run the backend

From `backend/`:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env locally with the project's real credentials.
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Backend `.env` keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`, and `PUBLIC_SITE_URL`. `.env` files are ignored. Restrict CORS to actual frontend origins in production. `/health` reports configuration status and explicitly reports `payments_enabled: false`; `/docs` provides the API reference.

## AiSensy setup

Create approved templates and active API campaigns in each of Telugu, Hindi, and English. Fill `AISENSY_API_KEY` and the `AISENSY_CAMPAIGNS` JSON mapping in the backend `.env`.

Template parameter order:

| Kind | Parameters, in order |
| --- | --- |
| `event_announcement` | Member name, translated event title, date/time in IST, events-page URL |
| `booking_confirmation` | Member name, translated event title, booking UUID, dashboard URL |
| `consultation_completed` | Member name, dashboard URL |

Do not include private Jatakam details in WhatsApp templates. The account language selects the campaign. The worker rechecks verified phone status and local opt-in before sending. Keep provider opt-out management enabled as well.

After configuring and reviewing the campaigns, explicitly start:

```powershell
.venv\Scripts\python.exe -m app.worker
```

Publishing atomically queues announcements for opted-in, phone-verified members. Repeated publishing does not queue duplicates. No external messages were sent during development.

The queue's `sent` status means HTTP acceptance by AiSensy, not proof of WhatsApp delivery/read. Delivery/opt-out webhook synchronization is not implemented yet. Rate limits are retried with bounded backoff. Timeouts, process crashes during sends, and ambiguous outcomes are held as failed for review instead of risking repeated messages. There is no automatic retry button for ambiguous sends.

## Verification

```powershell
npm.cmd test
npx.cmd playwright test
cd backend
.venv\Scripts\python.exe -m pytest -q
```

The browser tests require the Vite server on port 5173 and use installed Windows Chrome (see `playwright.config.ts`). They verify all three languages, persisted selection, dialogs, navigation, disabled preview actions, and mobile overflow. Screenshots are in `artifacts/`. The database tests use PGlite with stand-ins for Supabase-owned schemas, not a real Supabase service. Backend tests use mocked external calls and test access boundaries, event validation, image handling, and deferred payment state.

## Before a public launch

Connect and verify Supabase OTP, private uploads, password recovery, all three role dashboards, and AiSensy campaigns end to end with real accounts. Add the actual organisation identity, contact information, privacy/retention policy, cancellation terms, and reviewed Telugu/Hindi copy. The current privacy dialog is placeholder wording for the preview.

AWS hosting, production domain/TLS, backup/restore checks, ingress request-size limits and rate limits, monitoring, notification delivery/opt-out webhooks, and payment integration remain deployment work. Paginated admin history and booking management/cancellation screens are not included in this first version. Consultation replies are written responses; video/call scheduling is outside the agreed initial flow.

Uploaded images left after an ambiguous database/network failure must be reconciled against consultation records before any orphan cleanup. Do not blindly delete objects after a timeout. Validate real concurrent traffic and booking races in hosted PostgreSQL before release; the embedded tests do not establish production capacity.

# Feature-Stories Re-Verification — Findings

**Date:** 2026-06-22
**Scope:** Independent code-level re-verification of all 270 user stories in `qa/feature-stories.csv`, every one of which was previously marked **PASS**.
**Method:** 15 parallel verification agents, one per domain chunk. Each agent read the actual implementation on disk (pages, API routes, `lib/`, `components/`, `next.config.ts`) and judged whether the story's `expected_behaviour` is backed by real, non-stub code — *not* trusting the existing PASS marks.

Output: `qa/feature-stories-reverified.csv` adds a `reverify` column (VERIFIED / GAP / BROKEN / UNVERIFIABLE).

---

## Headline

The original "270/270 PASS" is **not reliable**. That pass largely confirmed that **redirects resolve** (every `/portal/...` and `/admin/...` alias in `next.config.ts` returns 200), not that the **destination delivers the feature**.

| Verdict | Count | % | Meaning |
|---|---|---|---|
| ✅ VERIFIED | 74 | 27% | Fully backed by real code |
| 🟠 GAP | 156 | 58% | Real backbone exists, but claimed sub-features missing |
| 🔴 BROKEN | 39 | 14% | Feature absent, or redirect lands on an unrelated/empty surface |
| ⚪ UNVERIFIABLE | 1 | 0% | External (status page) — out of repo scope |

### By domain

| Domain | Total | ✅ | 🟠 | 🔴 | Health |
|---|---|---|---|---|---|
| Auth | 6 | 6 | 0 | 0 | **Solid** |
| Public | 24 | 24 | 0 | 0 | **Solid** |
| Special | 8 | 7 | 0 | 1 | Strong |
| Social | 23 | 16 | 6 | 1 | Good |
| Portal | 29 | 8 | 13 | 8 | Weak |
| CRM | 28 | 7 | 16 | 5 | Weak |
| SEO | 13 | 1 | 7 | 5 | Poor |
| Documents | 12 | 1 | 10 | 1 | Poor |
| Email | 19 | 2 | 14 | 3 | Poor |
| Analytics | 14 | 0 | 12 | 2 | Poor |
| Billing | 13 | 1 | 3 | 9 | **Failing** |
| Reports | 4 | 0 | 4 | 0 | **Failing** |
| Admin | 77 | 1 | 71 | 4 | **Failing** |

---

## Important caveat — many "gaps" are spec/scope mismatches, not bugs

The `feature-stories.csv` reads like an **idealised superset** of a generic SaaS. The platform made deliberate scoping decisions that conflict with it. Before any of these are treated as "must build," confirm the story is actually in scope:

1. **Billing — EFT-first, not Stripe subscriptions.** 9 of 13 Billing stories are BROKEN because they assume Stripe subscriptions, plans, proration, coupons, usage metering, dunning, and a referral programme. The platform is intentionally **manual invoicing + EFT/PayPal** (per the EFT-first product direction). `US-297` (Stripe webhook) and most of `US-160/162/163/165/166/187/200/203` describe a product that may never be intended. **Decision needed: is subscription billing on the roadmap, or should these stories be descoped?**
2. **Analytics — product-analytics, not marketing-analytics.** The codebase ships a real, solid PostHog-style product-analytics engine (events, sessions, funnels, retention, live, GDPR purge, `@partnersinbiz/analytics-js` SDK). The 14 stories describe a *different* product: marketing-traffic dashboards, UTM builder, heatmaps, attribution, conversion goals. Real backend, wrong stories.
3. **Admin — placeholder hubs.** 71 of 77 Admin stories are GAP. The root cause is two patterns: (a) `/admin/settings` and `/admin/knowledge` render features as **static cards with no-op `<button>`s** (`AdminStubCard`); (b) `/admin/mission-control` panels are **hardcoded mock arrays** (System Jobs, Error Logs, Infra Status, Backups, Broadcast textarea is `disabled`). These are scaffolding, not features.

---

## 🔴 BROKEN — feature absent or redirect lands on the wrong surface (39)

These are the highest-integrity failures: the PASS mark is affirmatively misleading.

### Special / CRM / Social
- **US-036** Shared doc edit access control — `app/api/v1/public/client-documents/edit/[editShareToken]/route.ts:14` requires the code cookie *unconditionally* before loading the doc; sign-in-only documents are permanently inaccessible.
- **US-058** CRM Tags management — no `/portal/crm/tags` page/redirect/API; tags only editable per-contact.
- **US-073** Contact notes — no notes subsystem/API; notes is a single text field.
- **US-076** Suppression list — redirect → `/portal/email-preferences` (a notification-prefs page); backend exists, no UI.
- **US-091** Capture-source webhook — submission fires email only; no webhook URL field, POST, retry, or log.
- **US-096** Zapier/outbound webhook — redirect → inbound CRM integrations hub; outbound webhook lacks delivery log.
- **US-068** Social inbox reply — `inbox/page.tsx:203` `// TODO: Actually send the reply via the platform`; reply only PATCHes status, never posts.

### Email
- **US-138** Multi-client inbox preview — only a stateless HTML renderer; no client/device rendering.
- **US-140** Spam-score checker — no scoring endpoint; only pass/fail preflight.
- **US-145** RSS-to-email automation — no RSS trigger/digest/schedule.

### SEO
- **US-119** Content gap analysis — feature does not exist; bare redirect alias.
- **US-121** AI content-brief generator — does not exist.
- **US-122** Branded SEO report generator — does not exist.
- **US-123** Search Console connect — redirect → CRM integrations hub (no GSC); the **real working GSC flow** is at `/portal/seo/sprints/[id]/settings`, unreachable via the story's route.
- **US-144** Competitor tracker — does not exist.

### Analytics
- **US-134** Heatmaps — no heatmap code anywhere.
- **US-146** Multi-touch attribution — route not even aliased (would 404); only email-domain attribution exists.

### Billing (subscription model — confirm scope first)
- **US-160** Subscription billing overview · **US-162** Payment methods / Stripe · **US-163** Plan upgrade/proration · **US-165** Usage limits · **US-166** Coupons · **US-187** Cancel subscription · **US-200** Failed-payment dunning · **US-203** Annual billing toggle · **US-213** Referral programme — all absent; redirects funnel to manual `/portal/invoicing`.

### Documents
- **US-172** E-signature — no signature-request route, signer page, or draw/type canvas; only a typed-name approval flow.

### Portal (8 — several shadowed by redirects)
- **US-182** Team page — **regression**: `next.config.ts` redirect `/portal/settings/team` → `/portal/settings/permissions` shadows a **fully-built, working team page**. Nav links there. Removing the redirect restores it.
- **US-184** API keys · **US-186** White-label domain · **US-195** Audit log · **US-196** GDPR data export · **US-204** 2FA · **US-205** Session management · **US-212** Changelog — none exist; all redirect to account/dashboard.

### Admin
- **US-260** Org billing actions (read-only invoice list, no actions) · **US-264** Properties = analytics properties, not a feature-flag control plane · **US-274** Audit log → `/admin/settings` (no audit log there) · **US-297** Stripe webhook handler does not exist (core billing sync).

---

## 🟠 GAP — real backbone, missing claimed sub-features (156)

Full per-story detail is in the agent reports captured in the session. The recurring patterns:

- **CRM (16 gaps):** contacts list/detail/create lack pagination, status enum, tags columns, inline validation, dup-check; segments builder is fixed-filter not generic; export ignores active filters; timeline lacks event coverage; saved-views are a bar not sidebar; merge has no per-contact entry/conflict resolution; UTM source not captured.
- **Email (14 gaps):** redirects funnel email-campaign URLs into a **read-only** `EmailCampaignDetailWorkspace` and a general analytics dashboard, so the block editor, test-send, scheduler, deliverability dashboard, list-health, A/B execution, merge-tag UI, transactional API, and webhook "3-soft-bounces→hard" rule are all missing despite real underlying pieces (`BroadcastEditor`, `lib/email-builder`) existing elsewhere.
- **Analytics (12 gaps):** overview, traffic, conversions/goals, a.js snippet, custom-event management, UTM builder, audience demographics, reports scheduler, goal revenue, segment filter — none built; funnels/live work but lack date-range/segment/CSV.
- **Documents (10 gaps):** no version-history/restore UI, no live cursors/CRDT, editor lacks toolbar/auto-save/word-count/full-screen, tasks lack assignee/due-date, access-log lacks most fields, public-view share lacks access-mode/expiry toggles, comment notifications go to a hardcoded inbox.
- **SEO (7 gaps):** keyword tracker/audits/backlinks/on-page/performance are read-only displays of sprint data, not the interactive tools described (real PageSpeed/GSC backends exist but aren't surfaced as on-demand checkers).
- **Portal (13 gaps):** account/org/notification settings are thin; integrations grid is 4 CRM providers only; permissions is a 3-toggle guardrail not a role matrix; onboarding wizard, command-palette shortcuts, properties feature-flag gating, account-deletion purge all narrower than spec.
- **Reports (4 gaps):** fixed monthly cron report only; no builder, scheduler UI, type taxonomy, PDF download, or share-settings.
- **Admin (71 gaps):** see placeholder-hub patterns above.
- **Social (6 gaps):** social-post templates (→email templates), social listening (→inbox), first-comment (claimed via threadParts — false), PDF report export, LinkedIn profile/company selector, saved hashtag sets.

---

## ✅ VERIFIED — genuinely complete (74)

- **Auth (6/6)** and **Public (24/24)** are fully solid — real handlers, real error branches, `notFound()` on bad slugs, real forms posting to live APIs.
- **Social** is the strongest of the "platform" domains (16/23): real per-platform providers (Instagram Graph, LinkedIn UGC, Twitter v2 threads), composer, queue, calendar, analytics, OAuth.
- Scattered solid features: CRM segments/capture-sources/custom-fields/notifications/GDPR-export; Email templates + domain DKIM verification; SEO sprint management; Billing FeatureGate paywall; Documents template picker; Portal nav/command-palette/branding/theme/support; Admin access-denied page.

Two cosmetic notes (not failures): US-016 hero says "8 public tools" but catalog has 10; US-027 PASS-note claims `loyalty-plus` onboarding is live but it's commented out (only `athleet-management`).

---

## Recommended next steps

1. **Replace the PASS marks** — adopt `qa/feature-stories-reverified.csv` as the truthful baseline.
2. **Triage the stories first, code second.** Decide per-domain whether the *story* or the *code* is wrong:
   - Billing & Analytics: most likely **descope the stories** to match the EFT-first / product-analytics reality.
   - Admin: the stub hubs are real intent — these need **building**, prioritised by operational need.
3. **Quick wins (low effort, high integrity):**
   - US-182: delete the `/portal/settings/team` redirect to un-shadow the working team page.
   - US-123: repoint the SEO-integrations redirect to the real GSC settings page.
   - US-036: load the doc before the access-code check so sign-in-only docs work.
   - US-068: wire inbox reply to the existing social providers.
4. **Then** tackle GAP/BROKEN in priority order once scope is confirmed.

Closing all 195 GAP/BROKEN items blindly would mean building large subsystems (Stripe billing, 2FA, audit logging, heatmaps, attribution, e-signatures, the entire admin control plane). That needs your direction on scope and priority before code work starts.

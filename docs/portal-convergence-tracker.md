# Portal-First Convergence Tracker

**Status:** Phase 0 complete — Phase 1 complete — Phase 2 complete — Phase 3 complete — Phase 4 complete — Phase 5 (P5.1 clean, P5.2 done, P5.3 watching, P5.4 done)
**Spec:** [portal-first-convergence-spec.md](system-designs/portal-first-convergence-spec.md)
**Last updated:** 2026-06-11

---

## Tracking Table

| Section | Verdict | Phase | Branch/Commit | Parity Checklist | Status | Date |
|---|---|---|---|---|---|---|
| `organizations`, `org` | KEEP | — | — | — | ✅ Keep | — |
| `platform-members`, `platform-users` | KEEP | — | — | — | ✅ Keep | — |
| `agents`, `mission-control`, `skill-lab` | KEEP | — | — | — | ✅ Keep | — |
| `analytics` | SPLIT | Ph3 | — | — | ⏳ Pending | — |
| `settings`, `updates`, `knowledge` | KEEP | — | — | — | ✅ Keep | — |
| `support` | KEEP | — | — | — | ✅ Keep | — |
| `finance` | SPLIT | Ph3 | — | — | ⏳ Pending | — |
| `invoicing`, `quotes` | MOVE | Ph3 | — | — | ⏳ Pending | — |
| `crm` (contacts, pipeline) | MERGE | Ph1 | `9ec6829e` | ✅ All passed | ✅ Done | 2026-06-10 |
| `clients` (platform orgs) | FOLD → admin/organizations | Ph1 | `9ec6829e` | ✅ All passed | ✅ Done | 2026-06-10 |
| `research` | MERGE | Ph2 | `3c226c24` | ✅ Build green | ✅ Done | 2026-06-10 |
| `communications` | MERGE | Ph2 | `3f7567e6` | ✅ Build green | ✅ Done | 2026-06-10 |
| `reports` | MERGE | Ph2 | `18fce28c` | ✅ Build green | ✅ Done | 2026-06-10 |
| `capture-sources` | MERGE | Ph2 | `80975376` | ✅ Build green | ✅ Done | 2026-06-10 |
| `documents` | MERGE | Ph2 | `244c94bc` | ✅ Build green | ✅ Done | 2026-06-10 |
| `properties` | MERGE | Ph2 | `790ff96f` | ✅ Build green, extracted WorkspaceComponents | ✅ Done | 2026-06-10 |
| `geo-seo` | MERGE | Ph2 | `991d50d3` | ✅ Build green | ✅ Done | 2026-06-10 |
| `marketing` | MERGE | Ph2 | `218e9a54` | ✅ Build green | ✅ Done | 2026-06-10 |
| `briefings` | MERGE | Ph2 | `4c100489` | ✅ Build green | ✅ Done | 2026-06-10 |
| `email`, `email-analytics`, `email-templates`, `email-preferences`, `sequences`, `broadcasts` | MERGE | Ph2 | `6fb561af` | ✅ Build green, created portal pages for sequences/broadcasts/email-templates/email-preferences | ✅ Done | 2026-06-10 |
| `projects` | MERGE | Ph2 | `56879898` | ✅ Build green | ✅ Done | 2026-06-10 |
| `seo` | MERGE | Ph2 | `d707b2a7` | ✅ Build green, created portal pages for missing seo routes | ✅ Done | 2026-06-10 |
| `social` | MERGE | Ph2 | `3ec3c045` | ✅ Build green, created portal pages for design/queue/inbox/analytics/rss/bulk/replies | ✅ Done | 2026-06-10 |
| `campaigns` | MERGE | Ph2 | `0644ddd3` | ✅ Build green, sub-pages redirect to portal campaign cockpit | ✅ Done | 2026-06-10 |
| `invoicing`, `quotes` | MOVE | Ph3 | `b70e09d5` | ✅ Build green, portal pages created | ✅ Done | 2026-06-11 |
| `analytics` | SPLIT | Ph3 | `b70e09d5` | ✅ Build green, portal/analytics/* created | ✅ Done | 2026-06-11 |
| `intelligence` | MERGE | Ph3 | `b70e09d5` | ✅ Redirected → /portal | ✅ Done | 2026-06-11 |
| `finance` | MERGE | Ph3 | `b70e09d5` | ✅ Redirected → /portal/payments | ✅ Done | 2026-06-11 |
| `loop-engine` | KEEP | — | — | Platform control plane | ✅ Keep | — |
| `dashboard` | REBUILD | Ph4 | `dbd3b61f` | ✅ Control-plane hrefs updated | ✅ Done | 2026-06-11 |

---

## Phase Status

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Safety rails (CI gate, cross-tenant tests, tracker, linkedOrgId) | ✅ Complete |
| Phase 1 | Prove pattern on CRM + fold admin/clients → admin/organizations | ✅ Complete |
| Phase 2 | Long tail of MERGEs (14 sections) | ✅ Complete — development `9c441a92` |
| Phase 3 | MOVEs and SPLITs | ✅ Complete — `b70e09d5` |
| Phase 4 | Shrink admin | ✅ Complete — `dbd3b61f` |
| Phase 5 | VPS / agent side | ⚡ In progress — skills done (`a72bcec0`), partners-main 7-day watch started 2026-06-11 |
| Phase 6 | Deep URL sweep — all app/component/API stale admin paths | ✅ Complete — `3661dc87` (2026-06-11) |

---

## Phase 2 Summary

All 14 MERGE sections completed on 2026-06-10.

**Approach by section type:**
- **Trivial (thin-shell admin, portal equiv exists):** geo-seo, marketing, briefings — pure redirect + delete
- **Moderate (portal routes missing):** sequences, broadcasts, email-templates, email-preferences, projects — created portal thin shells using existing shared components; email-preferences/broadcasts list copied from admin
- **Complex (large inline pages, portal routes missing):** seo (7 missing routes created), social (7 missing routes created from admin), campaigns (sub-pages redirect to PortalCampaignCockpit)

**All builds green. All P2/P3 redirects use `permanent: false` — flip to `true` after 30 quiet days from 2026-06-10 (due: ~2026-07-10).**

---

## Phase 3 Summary (2026-06-11)

- `analytics` SPLIT: 9 portal pages created at `portal/analytics/*`; admin/analytics redirects to portal
- `intelligence` MERGE: nav hub deleted; `/admin/intelligence` → `/portal`
- `finance` MERGE: hub deleted; `/admin/finance` → `/portal/payments`
- `invoicing` MOVE: 5 portal pages created; redirects wired
- `quotes` MOVE: 3 portal pages created; redirects wired
- `loop-engine` KEEP verdict confirmed: platform engineering control plane, stays in admin

## Phase 4 Summary (2026-06-11)

- `navConfig.ts` stripped of all work-tool nav items (briefings, pipeline, marketing, intelligence, finance, documents, research)
- Admin control-plane nav: home, updates, loop-engine, organisations, agents, skill-lab, knowledge, support, settings
- Admin dashboard: portal hrefs updated, description updated to "control plane"

## Phase 5 Summary (2026-06-11)

- P5.1 VPS SOUL.md: all 13 profiles checked — no work-tool admin URL refs found (already clean)
- P5.2 Skills sweep: 11 skill files updated (analytics, geo-seo, seo, campaigns, research, properties, documents, social, reports, email, platform-ops)
- P5.3 partners-main retirement: 7-day traffic watch started 2026-06-11, retire window opens 2026-06-18
- P5.4 Agent dashboard: no admin work-tool links found in agents/mission-control pages

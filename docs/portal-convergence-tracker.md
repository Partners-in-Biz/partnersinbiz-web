# Portal-First Convergence Tracker

**Status:** Phase 0 complete — Phase 1 complete — Phase 2 partially complete (6/14 sections merged)
**Spec:** [portal-first-convergence-spec.md](system-designs/portal-first-convergence-spec.md)
**Last updated:** 2026-06-10

---

## Tracking Table

| Section | Verdict | Phase | Branch/PR | Parity Checklist | Status | Date |
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
| `clients` (platform orgs) | FOLD → admin/organizations | Ph1 | TBD | ✅ All passed | ✅ Done | 2026-06-10 |
| `campaigns` | MERGE | Ph2 | — | — | ⏳ Pending | — |
| `email`, `email-analytics`, `email-templates`, `email-preferences`, `sequences`, `broadcasts` | MERGE | Ph2 | — | — | ⏳ Pending | — |
| `marketing`, `social` | MERGE | Ph2 | — | — | ⏳ Pending | — |
| `seo`, `geo-seo` | MERGE | Ph2 | — | — | ⏳ Pending | — |
| `briefings` | MERGE | Ph2 | — | — | ⏳ Pending | — |
| `projects` | MERGE | Ph2 | — | — | ⏳ Pending | — |
| `research` | MERGE | Ph2 | `3c226c24` | ✅ Build green | ✅ Done | 2026-06-10 |
| `communications` | MERGE | Ph2 | `3f7567e6` | ✅ Build green | ✅ Done | 2026-06-10 |
| `reports` | MERGE | Ph2 | `18fce28c` | ✅ Build green | ✅ Done | 2026-06-10 |
| `capture-sources` | MERGE | Ph2 | `80975376` | ✅ Build green | ✅ Done | 2026-06-10 |
| `documents` | MERGE | Ph2 | `244c94bc` | ✅ Build green | ✅ Done | 2026-06-10 |
| `properties` | MERGE | Ph2 | `790ff96f` | ✅ Build green, extracted WorkspaceComponents | ✅ Done | 2026-06-10 |
| `intelligence`, `loop-engine` | VERIFY-THEN-MOVE | Ph3 | — | — | ⏳ Pending | — |
| `dashboard`, `page.tsx` | KEEP (rebuild last) | Ph4 | — | — | ⏳ Pending | — |

---

## Phase Status

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Safety rails (CI gate, cross-tenant tests, tracker, linkedOrgId) | ✅ Complete |
| Phase 1 | Prove pattern on CRM + fold admin/clients → admin/organizations | ✅ Complete |
| Phase 2 | Long tail of MERGEs | 🔄 In progress (6/14 done — research, communications, reports, capture-sources, documents, properties) |
| Phase 3 | MOVEs and SPLITs | ⏳ Pending |
| Phase 4 | Shrink admin | ⏳ Pending |
| Phase 5 | VPS / agent side | ⏳ Pending |

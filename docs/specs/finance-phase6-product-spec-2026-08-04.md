# Phase 6 product specification — Finance, Accounting & SA Payroll (market-proof + product depth)

**Document:** `Flie3SblIDXvplYmqOhy`  
**Portal:** https://partnersinbiz.online/portal/documents/Flie3SblIDXvplYmqOhy  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Org:** `pib-platform-owner`  
**Task:** `5rOjpXW4VzNsgtCxwz7I`  
**Author:** Iris (docs)  
**Date:** 2026-08-04  
**Host:** Peets-Mac-mini.local (`linked-device:87554b49-31b1-4484-8a1f-7075d6fa30ca`)  
**Status:** internal_draft (do not publish client-visible; do not promote without Peet)

## Versions

| Version id | Notes |
| --- | --- |
| `S21xNbkojHdW17Dh2z2a` | Current — Phase 6 market-proof + product-depth body |
| `pg1w4wGEJ8NoybhPNlji` | Prior — Phase 5 world-class body |
| `oK7CieqaGyuosUPQAT25` | Phase 4 body + callout title polish |
| `ebBA6xmSVKwf9PVEkraR` | Phase 4 competitor-parity body |
| `DCAh9tNOlloqSOwYSUP2` | Release-one foundation |

Live `currentVersionId` is authoritative via `GET /api/v1/client-documents/Flie3SblIDXvplYmqOhy` (expected `S21xNbkojHdW17Dh2z2a`).

## Decision

**Finance is not world-class after Phase 5 board close + production promote.** Phase 5 closed proving + density + selective depth. Phase 6 is **market-proof + daily-operator productization**:

1. Live multi-month books close + external accountant acceptance program  
2. Bank-feed productization on Phase 5 mock framework (still human-gated apply)  
3. Optional real provider adapter interface only; paid vendor behind separate Peet gate  
4. Expense claims + receipt capture (OCR optional lite, never auto-post)  
5. Revenue recognition schedules lite (not full ASC-606)  
6. Practice firm→client grant ACL  
7. Bulk scale/perf gates  
8. Keyboard/a11y power-user density  
9. Job-cost closed-loop polish (differentiator)  
10. Cash forecast multi-scenario depth (differentiator / stretch if capacity)  
11. Mobile/PWA ESS payslips + leave (stretch-ranked in research; **in-scope** on this board task)  
12. Expanded Vera audit + Quinn Phase 6 pack + **separate** Peet promote  

Incorporates Sage residual-gap research task `ENqHqSQMrpK49AyIMhBm` and research item `rYLnAvLeXSe1wUMW0ovS`. Durable gap map:

- `docs/research/finance-phase6-residual-gap-map-2026-08-03.md` @ `364be53bcece47069da870f5cf81eda32c76080c`
- Matrix HTML: `docs/research/finance-phase6-residual-gap-map-matrix-2026-08-03.html`
- Project doc `2j1umy5K06DhKxX7GUiE`
- Peet development scope gate `eqZUnsjDmKnE5tsnNXxX` (already done for development)
- Prior Phase 5: research `rJGYtdSsd6hMqcCgqivH` / `MjAevubofvCcbLOFsD5v`; acceptance `docs/operations/finance/phase5-acceptance-pack-2026-08-03.md`; runbooks `docs/operations/finance/operator-runbooks-phase5-close-2026-08-03.md`

## UX design-system lock

ModuleShell, PageHeader, Card, Button, HudChip, StatCard, ThemedSelect, shared tables/filters/empty/loading/error. Match billing/CRM — not a separate finance skin. Tenant via `scopedPortalPath` / `scopedApiPath` + `X-Org-Id`.

CEO data-decision rule: no permanent CEO dashboard as the default delivery surface; answers in Messages; temporary throw-away HTML only inside chat when visual comparison helps.

## Board workstream map

| Workstream | Task id |
| --- | --- |
| Spec (this) | `5rOjpXW4VzNsgtCxwz7I` |
| Peet development scope gate | `eqZUnsjDmKnE5tsnNXxX` |
| Research (upstream) | `ENqHqSQMrpK49AyIMhBm` |
| Market proof / live books + external accountant | `O2hbOSJb4gydptVGEOG2` |
| Bank productization | `6b2T04ZyWNXYn7yB9UAd` |
| Real-provider adapter stub | `vaNKABngcZf4TqYPpVcV` |
| Expense claims + receipts | `SZRWufZ64Qnr3aqF9YyZ` |
| Revenue recognition lite | `ng0kop4wEjqP68gt3M5f` |
| Firm→client grant ACL | Create/extend card if missing |
| Scale/perf + a11y | Theo + Quinn (shared) |
| Job-cost closed-loop polish | Differentiator card |
| Cash scenarios | Differentiator / stretch |
| Mobile/PWA ESS | Stretch (in-scope this board) |
| Vera extension | Vera |
| Quinn Phase 6 pack | Quinn |
| Peet prod promote | Separate Peet-only gate (later) |

## Capacity cut rule

Never cut market proof, bank daily productization on mock, hard gates, firm grant ACL for bureau GTM, or expense claims. Cut ESS mobile, deep cash AI, and inventory deepen first. Provider stub stays; **paid vendor bind never implied**.

## Hard non-goals

- No SARS e-file submit  
- No external payment initiation (export packs only)  
- No unapproved paid bank-feed / open-banking vendor contracts or spend  
- No mass client-visible statement/payslip email without separate approval  
- No production promote / main merge from this task or ordinary Phase 6 cards  
- No full WMS / manufacturing inventory  
- No full ASC-606 / IFRS 15 engine  
- No permanent CEO dashboard as the only decision surface  
- Bank apply remains human-gated; never auto-post (including OCR suggestions)

## Quinn checklist (summary)

Tenant isolation + grant ACL; design-system parity; market-proof multi-period live books + external sign-off; bank productization e2e + human gate; provider stub fail-closed; expenses lifecycle + OCR human gate; rev-rec lite journals; firm grants isolation; scale/perf smoke; keyboard/a11y close-week; ESS if shipped or explicit deferral; job-cost/cash if shipped; Vera extension; hard-gate negatives; P1–P5 regression; Peet-only promote; evidence in agentOutput.

## Safety

Internal draft only. No client publish. No SARS submit. No payment initiate. No paid bank-feed vendor. No prod promote. No share enable from this task.

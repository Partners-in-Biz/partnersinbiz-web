# Phase 5 product specification — Finance, Accounting & SA Payroll (world-class)

**Document:** `Flie3SblIDXvplYmqOhy`  
**Portal:** https://partnersinbiz.online/portal/documents/Flie3SblIDXvplYmqOhy  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Org:** `pib-platform-owner`  
**Task:** `y2BDxF7Iw78ShKRlGke3`  
**Author:** Iris (docs)  
**Date:** 2026-08-03  
**Status:** internal_draft (do not publish client-visible; do not promote without Peet)

## Versions

| Version id | Notes |
| --- | --- |
| `pg1w4wGEJ8NoybhPNlji` | Current — Phase 5 world-class body (proving, e2e, operator depth, bank feeds, role UX, bureau, export formats, inventory lite, Vera/Quinn/Peet) |
| `oK7CieqaGyuosUPQAT25` | Prior — Phase 4 body + callout title polish |
| `ebBA6xmSVKwf9PVEkraR` | Phase 4 competitor-parity body |
| `DCAh9tNOlloqSOwYSUP2` | Release-one foundation |

Live `currentVersionId` is authoritative via `GET /api/v1/client-documents/Flie3SblIDXvplYmqOhy` (expected `pg1w4wGEJ8NoybhPNlji`).

## Decision

**Finance is not world-class after Phase 4 board close (44/44 feature close).** Phase 4 closed table-stakes modules. Phase 5 is a proving + density + selective depth program:

1. Real-world proving kit (multi-entity multi-period close)
2. Browser e2e golden paths (Playwright) + hard-gate negatives
3. Operator edge-case depth / period-close blockers
4. Bank-feed connector framework — **mock-first**, human-gated apply only
5. Role-specific UX (owner / bookkeeper / accountant / practice)
6. Payroll bureau lite (multi-entity batch, bulk payslips, leave calendar, EMP501 polish)
7. Payment instruction export format expansion (observe-only ACB/NetCash-style files)
8. Vera independent calc audit
9. Quinn Phase 5 acceptance + Peet promote gates

**Differentiator:** inventory/stock lite + COGS (not WMS).  
**Stretch:** mobile ESS, multi-country payroll, expense OCR, deep cash AI, firm→client grant ACL.

Incorporates Sage residual-gap research task `rJGYtdSsd6hMqcCgqivH` and research item `MjAevubofvCcbLOFsD5v`. Durable gap map:

- `docs/research/finance-phase5-residual-gap-map-2026-08-03.md`
- Project doc `s0wKRciyQ2uWWQU8EjBK`
- Close runbooks: `docs/operations/finance/operator-runbooks-phase5-close-2026-08-03.md`
- Acceptance pack: `docs/operations/finance/phase5-acceptance-pack-2026-08-03.md`
- Project doc `4oJOy1K8liHXCl2mk6dV`

## UX design-system lock

ModuleShell, PageHeader, Card, Button, HudChip, StatCard, ThemedSelect, shared tables/filters/empty/loading/error. Match billing/CRM — not a separate finance skin. Tenant via `scopedPortalPath` / `scopedApiPath` + `X-Org-Id`.

CEO data-decision rule: no permanent CEO dashboard as the default delivery surface; answers in Messages; temporary throw-away HTML only inside chat when visual comparison helps.

## Board workstream map

| Workstream | Task id |
| --- | --- |
| Spec (this) | `y2BDxF7Iw78ShKRlGke3` |
| Peet scope gate | `iA0dOv2NYxDjNim4S8L8` |
| Proving kit | `QkRVcgafdbuklU2hQyPs` |
| E2E golden paths | `ByV0Q2WwB3XbpQavF82W` |
| Operator depth | `T5BOeWaQR0XGpb39VfuY` |
| Bank feeds mock-first | `Bsk58c2oq7BuMKhLFcHm` |
| Role UX | `2W79LIFTV5v12J8CTW56` |
| Payroll bureau lite | `0KqsOlaCnVo6JomTdB8F` |
| Payment export formats | `GiLXtg26kg477b2BYYul` |
| Inventory/COGS lite | `m6P7jrp57im6pTp2Z56i` |
| Quinn QA suite | `9FpncDVhnhaozaKKTgHt` |
| Peet prod promote | `mvAO92O7YmOJCiX0RiiO` |

## Hard non-goals

- No SARS e-file submit
- No external payment initiation (export packs only)
- No unapproved paid bank-feed / open-banking vendor contracts or spend
- No mass client-visible statement/payslip email without separate approval
- No production promote / main merge from this task or ordinary Phase 5 cards
- No full WMS / manufacturing inventory
- No permanent CEO dashboard as the only decision surface

## Capacity cut rule

Never cut proving kit, e2e, hard gates, or bank-feed **framework**. Cut inventory/COGS and stretch ESS mobile first.

## Quinn checklist (summary)

Tenant isolation; design-system parity; proving multi-period close; browser e2e + hard-gate negatives; period-close blockers; bank-feed mock sync human gate; role UX least privilege; payroll bureau month-end; export formats download-only; inventory if shipped; Vera calc audit evidence; packaging egress false; P1–P4 regression; Peet-only promote; evidence in agentOutput.

## Safety

Internal draft only. No client publish. No SARS submit. No payment initiate. No paid bank-feed vendor. No prod promote.

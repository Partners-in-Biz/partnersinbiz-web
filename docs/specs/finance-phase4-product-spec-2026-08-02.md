# Phase 4 product specification — Finance, Accounting & SA Payroll

**Document:** `Flie3SblIDXvplYmqOhy`  
**Portal:** https://partnersinbiz.online/portal/documents/Flie3SblIDXvplYmqOhy  
**Project:** `HRCSWl1cNnh6fYEGziAb`  
**Org:** `pib-platform-owner`  
**Task:** `BKF7tuwiI5DPguKgktQF`  
**Author:** Iris (docs)  
**Date:** 2026-08-02  
**Status:** internal_draft (do not promote without Peet)

## Versions

| Version id | Notes |
| --- | --- |
| `oK7CieqaGyuosUPQAT25` | Current — Phase 4 body + callout title polish |
| `ebBA6xmSVKwf9PVEkraR` | Phase 4 competitor-parity body (UX lock, AC, non-goals, Quinn checklist) |
| Prior | `DCAh9tNOlloqSOwYSUP2` release-one foundation |

Live `currentVersionId` is authoritative via `GET /api/v1/client-documents/Flie3SblIDXvplYmqOhy` (expected `oK7CieqaGyuosUPQAT25`).

## Decision

Phase 4 closes **operator-parity** gaps first (UX hub, AR/AP depth, bank rules, multi-currency, payroll leave/ESS, roles/practice, onboarding), then differentiates on multi-entity IC, CRM/project job costing, cross-org pay confirm, and unified ZA packaging.

Incorporates Sage research task `IzVNzZRz2dmhhrgJuxHA` and research item `6OjqsbjAGkZue9vmTUbD`. Durable gap map:

- `docs/research/finance-phase4-competitor-gap-map-2026-08-02.md`
- Project doc `LWonOIrWrCWXkIZYL3JA`

## UX design-system lock

ModuleShell, PageHeader, Card, Button, HudChip, StatCard, ThemedSelect, shared tables/filters/empty/loading/error. Match billing/CRM — not a separate finance skin. Tenant via `scopedPortalPath` / `scopedApiPath` + `X-Org-Id`.

## Hard non-goals

- No SARS e-file submit
- No external payment initiation (export packs only)
- No mass client-visible statement/payslip email without separate approval
- No production promote / main merge from this task

## Quinn checklist (summary)

Tenant isolation; design-system parity; hub stats; AR/AP golden path; bank rules human gate; FX realized vs unrealized; job costing time→report; payroll leave+ESS; roles least privilege; onboarding path; negative tests for SARS submit / payment initiate / mass email; audit explorer; packaging egress false; P1–P3 regression; evidence in agentOutput.

## Safety

Internal draft only. No client publish. No SARS submit. No payment initiate. No prod promote.

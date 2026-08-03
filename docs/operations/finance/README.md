# Finance operator docs

Internal operator runbooks and acceptance evidence for Partners in Biz Finance, Accounting & South African Payroll.

| Doc | Purpose |
| --- | --- |
| [Operator runbooks (Phase 5 close)](./operator-runbooks-phase5-close-2026-08-03.md) | World-class monthly close by role, bank feed recon, multi-entity consolidation, payroll bureau month-end, accountant pack walkthrough, import incident/rollback |
| [Phase 5 acceptance pack](./phase5-acceptance-pack-2026-08-03.md) | Quinn staging checklist for Phase 5 close surfaces + verifies |
| [Operator runbooks (Phase 4)](./operator-runbooks-phase4-2026-08-02.md) | Day-0 setup through day-2 ops, hard gates, HTTP map, empty-state guidance |
| [Phase 4 acceptance pack](./phase4-acceptance-pack-2026-08-02.md) | Quinn / Peet staging acceptance checklist with verify commands |
| [Phase 4 product spec mirror](../../specs/finance-phase4-product-spec-2026-08-02.md) | Spec index for document `Flie3SblIDXvplYmqOhy` |
| [Competitor gap map](../../research/finance-phase4-competitor-gap-map-2026-08-02.md) | Research basis for Phase 4 |
| [Phase 5 residual gap map](../../research/finance-phase5-residual-gap-map-2026-08-03.md) | Research basis for Phase 5 |
| [Canonical data model](../../architecture/finance-accounting-payroll-data-model.md) | Architecture |

## Portal surfaces

- Setup / guided onboarding: `/portal/finance/setup`
- Operator runbooks (in-app): `/portal/finance/runbooks`
- Period-close command centre: `/portal/finance/period-close`
- Bank feeds (mock-first): `/portal/finance/bank-feeds`
- Proving kit + accountant checklist: `/portal/finance/proving`
- Canonical product spec (internal): https://partnersinbiz.online/portal/documents/Flie3SblIDXvplYmqOhy
- Project board: `HRCSWl1cNnh6fYEGziAb`

## Hard non-goals (all runbooks)

- No SARS e-file submit
- No external payment initiation (export packs only)
- No mass client-visible payslip/statement email without separate approval
- No production promote / main merge from ordinary implementation cards
- No permanent CEO dashboard as the finance delivery surface (Messages + operator runbooks)

# Finance operator docs

Internal operator runbooks and acceptance evidence for Partners in Biz Finance, Accounting & South African Payroll.

| Doc | Purpose |
| --- | --- |
| [Operator runbooks (Phase 4)](./operator-runbooks-phase4-2026-08-02.md) | Day-0 setup through day-2 ops, hard gates, HTTP map, empty-state guidance |
| [Phase 4 acceptance pack](./phase4-acceptance-pack-2026-08-02.md) | Quinn / Peet staging acceptance checklist with verify commands |
| [Phase 4 product spec mirror](../../specs/finance-phase4-product-spec-2026-08-02.md) | Spec index for document `Flie3SblIDXvplYmqOhy` |
| [Competitor gap map](../../research/finance-phase4-competitor-gap-map-2026-08-02.md) | Research basis for Phase 4 |
| [Canonical data model](../../architecture/finance-accounting-payroll-data-model.md) | Architecture |

## Portal surfaces

- Setup / guided onboarding: `/portal/finance/setup`
- Operator runbooks (in-app): `/portal/finance/runbooks`
- Canonical product spec (internal): https://partnersinbiz.online/portal/documents/Flie3SblIDXvplYmqOhy
- Project board: `HRCSWl1cNnh6fYEGziAb`

## Hard non-goals (all runbooks)

- No SARS e-file submit
- No external payment initiation (export packs only)
- No mass client-visible payslip/statement email without separate approval
- No production promote / main merge from ordinary implementation cards

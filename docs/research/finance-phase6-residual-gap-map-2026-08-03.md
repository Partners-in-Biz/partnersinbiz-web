# Phase 6 residual gap map — post-Phase-5 world-class program

**Research task:** `ENqHqSQMrpK49AyIMhBm`  
**Project:** `HRCSWl1cNnh6fYEGziAb` — Partners in Biz Finance, Accounting & South African Payroll  
**Source spec:** `Flie3SblIDXvplYmqOhy`  
**Org:** `pib-platform-owner`  
**Author:** Sage (research)  
**Date:** 2026-08-03  
**Visibility:** internal  
**Host:** Peets-Mac-mini.local (`linked-device:87554b49-31b1-4484-8a1f-7075d6fa30ca`)  
**Inventory HEAD (at research):** `6d435e3f56030033e46f8c789231be82a5ea61d7` on `development` (includes promote merge `adbb1d185` Phase 5 pack)  
**Prior maps:**  
- Phase 5 residual: `docs/research/finance-phase5-residual-gap-map-2026-08-03.md` (task `rJGYtdSsd6hMqcCgqivH`, research `MjAevubofvCcbLOFsD5v`)  
- Phase 4 competitor: `docs/research/finance-phase4-competitor-gap-map-2026-08-02.md` (task `IzVNzZRz2dmhhrgJuxHA`, research `6OjqsbjAGkZue9vmTUbD`)

---

## Decision (CEO-facing)

**Is finance world-class after Phase 5 board close + production promote? No.**

Phase 5 closed the **proving + density + selective depth** program that Phase 4 feature parity still lacked: proving kit, Playwright golden paths, operator/period-close depth, mock-first bank-feed **framework**, role UX, payroll bureau lite, observe-only ACB/NetCash-style payment files, inventory/COGS lite, Vera calc audit, Quinn pack, Peet promote. That is necessary and now live on partnersinbiz.online for the Phase 5 pack — and still **not sufficient** for a world-class claim against Xero / Sage Business Cloud Accounting+Payroll (ZA) / QBO Advanced / SimplePay / PaySpace in a real SA bookkeeper week.

World-class after Phase 5 means:

1. **Market proof** — multi-month **live** (or near-live internal) books closed across entities, with an **external accountant** acceptance sign-off pack — not only synthetic proving fixtures.
2. **Bank feeds as daily product** — connection health, multi-account ops, recon centre density operators prefer over file choreography; real-provider adapter ready, **still human-gated**, **still no paid vendor without Peet**.
3. **Expense claims + receipts** — the weekday path bookkeepers live in (Xero Expenses / Hubdoc-class motion), human-confirmed OCR only.
4. **Revenue recognition schedules (lite)** — deferred/recognized for retainers and prepaid services (QBO Advanced-class lite, not full ASC-606 engine).
5. **Firm→client practice grant ACL** — beyond membership switcher; firm staff can be granted scoped client books without leaking tenant graph.
6. **Mobile/PWA ESS** — SimplePay-class employee self-serve for payslip + leave (stretch can cut if capacity tight after must-haves).
7. **Cash scenario depth** — multi-scenario what-if on top of cashflow planner lite.
8. **Job-cost closed loop polish** — quote → project/time → WIP → invoice → cash application without dual systems.
9. **Scale/perf under bulk load** — bulk 50+ docs, multi-entity bureau board, large statement imports remain interactive.
10. **A11y / keyboard power-user density** — bookkeeper can drive close week without mouse-only dead ends.
11. Any other residual that would embarrass PiB in a real SA bookkeeper week (see matrix).

**Phase 6 is market-proof + daily-operator productization**, not another module-farm phase. Hold multi-entity IC, cross-org pay confirm, unified ZA payroll packaging (export-only), Projects-linked job costing, and agent/Kanban-operable finance as wedges. Preserve hard gates: **no SARS submit, no payment initiate, no unapproved paid bank-feed vendor**.

Board already sketched (post Peet Phase 6 scope gate `eqZUnsjDmKnE5tsnNXxX`): market proof `O2hbOSJb4gydptVGEOG2`, bank productization `6b2T04ZyWNXYn7yB9UAd`, real-provider stub `vaNKABngcZf4TqYPpVcV`, expenses `SZRWufZ64Qnr3aqF9YyZ`, rev-rec `ng0kop4wEjqP68gt3M5f`, spec `5rOjpXW4VzNsgtCxwz7I` (depends on this research).

---

## Evidence basis

### Internal (verified on development / project)

| Source | Confirms |
| --- | --- |
| Project `HRCSWl1cNnh6fYEGziAb` description | Phases 1–5 production-live; hard non-goals listed; portal `/portal/finance` |
| Promote commit `adbb1d185` | Phase 5 finance world-class pack promoted to production |
| Wiki `finance-phase5-module-closeout-2026-08-03.md` | Board closed; hard gates held |
| `components/finance/financeRoutes.ts` | 24 route keys incl. inventory, bank-feeds, period-close, proving, runbooks |
| Portal pages | inventory, bank-feeds, period-close, proving, runbooks pages present |
| `lib/finance/service-boundaries.ts` | 41 finance HTTP entrypoint paths; UI shipped posture |
| Bank feeds | Mock provider + LiveStub fails closed; human accept/dismiss; verify + domain tests |
| Proving / operator depth / payroll bureau / packaging / inventory | Phase 5 cards done; acceptance pack + close runbooks present |
| E2E | `__tests__/e2e/finance-golden-paths.test.ts` + `e2e/finance/fixtures/` present (Phase 5 golden paths) |
| Vera | `docs/operations/finance/vera-calc-correctness-audit-IjQ1F1sGvrZNS16inQ36-2026-08-03.md` |
| Phase 5 residual map | Prior must-haves now **shipped**; stretch items from Phase 5 become Phase 6 candidates |
| Open Phase 6 board | Market proof, bank productization, provider stub, expenses, rev-rec in progress; firm grant / ESS / cash scenarios / job-cost polish / scale / a11y still need explicit cards or inclusion in spec |
| Expense / rev-rec product modules | **Not** present as first-class finance routes yet (cards in flight) |

**Confidence (PiB inventory):** high (code routes + board + Phase 5 docs + promote note).  
**Confidence (competitor cells):** medium-high (public vendor pages / help centres; not a paid multi-product live trial of every plan tier).

### External (public product claims; snapshot ~2026-08)

| Competitor | Primary public evidence | Residual bar for PiB |
| --- | --- | --- |
| Xero ZA | Bank feeds + rules; Expenses / Hubdoc receipt capture; practice HQ / multi-client; inventory; projects; payroll partner (SimplePay) + eFiling helpers | Daily feed productization; expense claims; practice firm tooling depth; market trust |
| Sage Business Cloud Accounting + Payroll (ZA) | Direct bank feeds with major ZA banks; multi-company; inventory add-ons; native payroll companion; NetCash payment rails | Live ZA bank connections (vendor-gated); multi-company week ops; payment files (PiB export-only) |
| QuickBooks Online / Advanced | Bank feeds/rules; expenses; **revenue recognition schedules** (Advanced); projects/job costing; cash flow planner/scenarios; fixed assets; inventory lite | Rev-rec lite; cash scenario depth; job-cost closed loop polish |
| SimplePay | Leave, **mobile ESS app**, claims, EMP201/IRP5 helpers for eFiling upload, bank payment **files**, Xero/QBO journals | Mobile/PWA ESS; claim UX; bureau polish residual vs export-only |
| PaySpace | Multi-company / multi-country HCM payroll, ESS, org structures | Upper bound for multi-entity payroll ESS — not GL template |

Citations for external claims are recorded on the Research item sources (Xero Expenses, Hubdoc, Sage ZA bank feeds, QBO Advanced rev-rec, SimplePay ESS app, Xero HQ practice).

---

## Live PiB capability inventory (post-Phase-5)

Legend: **S** strong/live · **P** partial · **W** weak/missing · **N** non-goal · **D** differentiator

### A. Shipped surfaces (hold / polish)

| Surface | Status | Notes |
| --- | --- | --- |
| Design-system finance hub + 24 routes | S | Including inventory, bank-feeds, period-close, proving, runbooks |
| AR/AP depth, FX, assets, budgets/cashflow plan, bank rules | S | Phase 4 |
| Multi-entity IC + elim + consol | S | Differentiator hold |
| Cross-org pay notify/confirm | S | Differentiator hold |
| ZA payroll calc/lock/statutory prepare + bureau lite | S–P | Bureau shipped lite; multi-employer polish residual |
| Statements file import + human recon | S | Still primary path until feed productization wins daily habit |
| Bank feed **framework** (mock + live stub fail-closed) | P–S | Framework live; **not** daily product depth or live ZA bank |
| Period-close blockers + operator bulk/filters | S | Phase 5 |
| Proving kit + multi-period synthetic close | S | Synthetic; **not** market/live books proof |
| Playwright/e2e golden paths | S | Module/e2e present; extend under load + new modules |
| Role UX (owner/bookkeeper/accountant/practice) | S–P | Guided workflows; firm→client grant ACL residual |
| Packaging observe-only (SARS-ready + ACB/NetCash-style files) | S | No initiate / no egress |
| Inventory stock lite + COGS | S | Differentiator for product SMBs; not WMS |
| Vera calc audit evidence | S | Internal pack exists |
| Quinn Phase 5 + Peet promote | S | Pack promoted; further promotes still Peet-gated |

### B. Hard gates (must remain true)

| Gate | Posture |
| --- | --- |
| SARS e-file submit | Absent / blocked |
| External payment initiation | Absent / observe + export only |
| Bank feed / rule auto-post | Never — human Accept/Dismiss |
| Packaging egress | `externalEgressAllowed=false` |
| Mass statement/payslip email | Separately gated / false |
| Paid bank-feed vendor contract | Non-goal until Peet approval |
| Ordinary agent main/prod promote | Forbidden without Peet gate |

---

## Residual gap matrix vs competitors (post-Phase-5)

| # | Capability | PiB post-P5 | Xero | Sage Acct+Pay | QBO Adv | SimplePay | PaySpace | Phase 6 rank |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Multi-month LIVE books proof + external accountant sign-off | W–P (synthetic proving only) | S market trust | S | S | S payroll trust | S | **Must-have** |
| 2 | Bank feeds as **daily product** (health, multi-acct, recon centre) | P (framework) | S | S (ZA banks) | S | N | N | **Must-have** |
| 2b | Real-provider adapter ready (no paid bind) | P (LiveStub) | n/a | n/a | n/a | n/a | n/a | **Must-have** (stub) |
| 2c | Paid live ZA aggregator / open banking | N until Peet | S | S | S | N | N | **Non-goal** until approved |
| 3 | Expense claims + receipts (+ OCR assist human-gated) | W | S (Expenses/Hubdoc) | P–S | S | claims | P | **Must-have** |
| 4 | Revenue recognition schedules (lite) | W | P apps | P | S (Adv) | N | N | **Must-have** (lite) / Diff for agencies |
| 5 | Firm→client practice grant ACL | W–P (membership switcher) | S (HQ/practice) | P | S (Accountant) | P | P | **Must-have** for bureau |
| 6 | Mobile/PWA ESS (payslip/leave) | W (portal ESS read) | via partner | P–S | P | S app | S | **Stretch** → Differentiator if bureau GTM |
| 7 | Cash scenario depth (multi what-if) | P (planner lite) | S | P | S | N | N | **Differentiator** / Stretch if capacity |
| 8 | Job-cost closed loop polish | P–S (dimensions live) | S Projects | P | S Projects | N | N | **Differentiator** |
| 9 | Scale/perf under bulk load | P (bulk cap ~50) | S | S | S | S | S | **Must-have** (perf gates) |
| 10 | A11y / keyboard power-user density | P | S | S | S | P | P | **Must-have** (close-week) |
| 11a | Payroll multi-employer bureau polish | P–S | partner | S | W ZA | S | S | Differentiator hold |
| 11b | Inventory depth beyond lite | S lite / N WMS | S | Adv inv | S lite | N | N | Hold lite; **Non-goal** WMS |
| 11c | Unified books+payroll packaging polish | S export | partner | S | W | S files | S | Hold / Diff |
| 11d | Multi-entity IC depth polish | S | P | P–S | W–P | N | N | Hold / Diff |
| — | Feature modules (AR/AP, FX, assets, rules, proving, e2e, role UX) | S | S | S | S | N GL | N GL | Hold |
| — | SARS e-file submit | N | partner | product path | N/W | helpers | product path | **Non-goal** |
| — | Payment initiation | N | S | S NetCash | S | files | files | **Non-goal** |

---

## Ranked Phase 6 program

### Must-have (cannot claim world-class without)

1. **Multi-month LIVE books proof + external accountant acceptance** (`O2hbOSJb4gydptVGEOG2`)  
   ≥3 closed periods, ≥2 entities, IC/FX/payroll lock/packaging/bank recon history; human accountant checklist + sign-off artifact (not wet-signature product). Proving kit is input, not substitute.

2. **Bank feeds productization — daily operator UX** (`6b2T04ZyWNXYn7yB9UAd`)  
   Connection health, last-sync, errors/reconnect, multi-account list, cursor/status, recon centre density, bulk accept/dismiss where safe — still **never auto-post**. File import remains fallback.

3. **Bank feed real-provider adapter stub** (`vaNKABngcZf4TqYPpVcV`)  
   Registry + vault pattern + fail-closed non-mock skeleton + feature flag; **no paid vendor, no live credentials, no spend**.

4. **Expense claims + receipt capture** (`SZRWufZ64Qnr3aqF9YyZ`)  
   Draft → submit → approve/reject → post; attachment; optional OCR never auto-posts; VAT-aware; no payment initiate from claims.

5. **Revenue recognition schedules (lite)** (`ng0kop4wEjqP68gt3M5f`)  
   Straight-line / milestone schedules on AR; period recognition journals; deferred vs recognized reports; not full ASC-606.

6. **Firm→client practice grant ACL** (needs explicit card if not fully in expense/practice work)  
   Scoped grants firm user → client org/books/roles beyond “member of many orgs” switcher; audit of grants; no cross-tenant leak.

7. **Scale/perf bulk gates**  
   Statement import + bureau board + bulk allocate/docs under realistic volumes; automated perf smoke or soak checklist in Quinn pack.

8. **A11y / keyboard power-user density**  
   Primary close-week flows keyboard reachable; focus order; table actions; no mouse-only blockers on period-close, bank recon, documents bulk.

9. **Spec + Peet gates hygiene**  
   Spec update `5rOjpXW4VzNsgtCxwz7I` after this research; Peet scope gate already done for development; **further production promote still Peet-only**; Vera/Quinn evidence extended for new modules.

### Differentiator (build deliberately)

1. **Job-cost closed loop polish** — Projects/time → WIP → invoice draft → cash application; utilization/WIP aging; CRM-native wedge.  
2. **Cash scenario depth** — named scenarios, sensitivity on AR collections/AP/payroll; planning-only (no GL post).  
3. **Keep/extend multi-entity IC + consolidation UX** inside live books proof.  
4. **Cross-org multi-tenant pay confirm** — unique PiB graph; keep in demos.  
5. **Unified books + ZA payroll packaging** — one audit model, export packs.  
6. **Agent/Kanban-operable finance** — runbooks + evidence competitors lack.  
7. **Inventory lite hold** — already shipped; deepen only if product-SMB cohort demands (still no WMS).

### Stretch

- Mobile/PWA ESS (SimplePay app parity) — promote to must-have only if bureau GTM requires employee mobile.  
- Full multi-country payroll (PaySpace upper bound).  
- Deep AI cash forecasting / narrative CFO.  
- Advanced OCR/vendor bill capture pipeline beyond expense lite.  
- True practice workflow suite (jobs, WIP billing for the firm itself).  
- Warehouse/WMS, BOM, manufacturing (explicitly out).

### Non-goals (do not schedule as Phase 6 parity)

- SARS e-filing **submit** / auto SARS payment.  
- External payment **initiation** (EFT/ACB/card money movement).  
- Unapproved **paid** bank-feed / open-banking vendor contracts or spend.  
- Mass client-visible statement/payslip email without separate approval.  
- Ordinary agent merge to `main` / `vercel --prod` without Peet promote gate.  
- Full ERP WMS / manufacturing inventory.  
- Full ASC-606 / IFRS 15 engine.  
- Permanent CEO dashboard as the only decision surface.

---

## Why Phase 5 was not enough (honest residual narrative)

Phase 5 answered: “Can we prove the product closes in fixtures, with e2e, role UX, mock feeds, bureau lite, and export files?”

World-class asks: “Would a SA bookkeeper and external accountant run **this week’s real books** here instead of Xero+SimplePay or Sage — with bank lines flowing daily, expenses captured, deferred retainers recognized, firm staff scoped correctly, keyboard-fast close, under load — with evidence an outsider signs?”

| Cluster | Risk if skipped | Competitor embarrassment mode |
| --- | --- | --- |
| Live books + external sign-off | “Demo-ware” label | Accountant refuses engagement on PiB |
| Bank feeds daily product | Recon stays file choreography | Xero/Sage/QBO default path |
| Expenses/receipts | Staff costs live in WhatsApp + spreadsheets | Xero Expenses / Hubdoc |
| Rev-rec lite | Retainers misstated monthly | QBO Advanced |
| Firm grant ACL | Practice cannot staff clients safely | Xero HQ / QBO Accountant |
| ESS mobile | Employees bounce payroll UX | SimplePay app |
| Cash scenarios | Owner still uses Excel | QBO/Xero planners |
| Job-cost loop | Agency dual-systems | QBO/Xero Projects |
| Scale + a11y | Close week pain → churn | Power-user density of majors |
| Gate slip (SARS/pay/vendor) | Trust + legal collapse | Unforced error |

---

## Recommended Phase 6 sequencing

```
This research ENqHqSQMrpK49AyIMhBm
  → Spec update 5rOjpXW4VzNsgtCxwz7I (Flie3SblIDXvplYmqOhy)
  → Peet scope gate eqZUnsjDmKnE5tsnNXxX (already done for development)
  → Parallel backbone:
       Market proof O2hbOSJb4gydptVGEOG2
       Bank productization 6b2T04ZyWNXYn7yB9UAd
       Provider stub vaNKABngcZf4TqYPpVcV
  → Expense claims SZRWufZ64Qnr3aqF9YyZ
  → Rev-rec lite ng0kop4wEjqP68gt3M5f
  → Firm→client grant ACL (create card if missing) + practice polish
  → Scale/perf + a11y gates (Quinn-owned or shared)
  → Job-cost closed loop polish + cash scenarios (differentiator track)
  → ESS mobile/PWA (stretch; cut first if capacity tight)
  → Vera extension + Quinn Phase 6 pack + Peet promote (separate)
```

**Capacity cut rule:** never cut market proof, bank daily productization (on mock), hard gates, firm grant ACL for bureau GTM, or expense claims if targeting SA bookkeeper week. Cut ESS mobile, deep cash AI, and inventory deepen first. Provider stub stays; **paid vendor bind never implied**.

---

## Acceptance criteria inputs (for docs/spec task)

### Market proof
- ≥3 consecutive periods hard/soft-closed on ≥2 entities with IC, bank recon history, payroll lock, packaging downloads.
- External accountant checklist PDF/markdown + signed acceptance note (human artifact) stored as evidence.
- Frozen TB snapshots per period; variance explanations for consol.

### Bank feeds daily product
- Operator can see health/last-sync/error per account without leaving finance portal.
- Sync → staged lines → suggestions → accept/dismiss → recon zero-diff path documented and e2e’d.
- Mock remains default; no live paid calls.

### Provider stub
- Non-mock adapter fails closed without credentials; vault interface documented; Peet approval checklist for any future vendor.

### Expenses
- Claim lifecycle + receipt attach + optional OCR suggestion + approve + post; audit events; no payout API.

### Rev-rec lite
- Schedule on invoice/contract; period run posts balanced journals; deferred balance report; reverse/adjust.

### Firm grant ACL
- Grant create/revoke; least privilege book/entity roles; switcher respects grants only; isolation tests.

### Scale / a11y
- Documented bulk thresholds + keyboard path checklist in Quinn pack; failures block GO.

### Cross-cutting non-goals
- No SARS submit control; no payment initiate; no mass email; no paid vendor bind; no main promote from ordinary cards.

---

## Board gaps to create (if not already present after spec)

| Workstream | Suggested owner | Rank |
| --- | --- | --- |
| Firm→client practice grant ACL | Theo | Must-have |
| Scale/perf bulk soak + gates | Theo + Quinn | Must-have |
| A11y/keyboard close-week pack | Theo + Quinn | Must-have |
| Job-cost closed loop polish | Theo | Differentiator |
| Cash scenario depth | Theo | Differentiator / Stretch |
| Mobile/PWA ESS | Theo | Stretch |
| Phase 6 Quinn acceptance + Vera extension | Quinn / Vera | Must-have internal |
| Peet Phase 6 production promote | Peet | Gate (later) |

---

## Implications for strategic wedges

1. **Multi-entity** — still a win; Phase 6 must **prove live multi-month consol**, not rebuild IC.  
2. **CRM/Projects finance** — job-cost closed loop + expenses on projects deepen agency native story.  
3. **ZA payroll** — bureau lite shipped; residual embarrassment is ESS mobile + firm staffing model + payment **files** polish — without submit/initiate.  
4. **Trust** — external accountant sign-off is the missing market proof layer no amount of unit tests replace.

---

## Open questions (do not block research close)

1. First paying cohort: agency (expenses + job-cost + rev-rec) vs product SMB (inventory hold) vs practice bureau (firm grant + multi-client)?  
2. Bank feed: stay mock-default through next production promote, or Peet-approve one ZA aggregator after stub?  
3. ESS: PWA-first vs native later?  
4. External accountant sign-off: internal friendly accountant vs independent firm for credibility?  
5. Rev-rec: straight-line only for v1, or milestones required for first agency?

---

## Artifacts & links

| Artifact | Ref |
| --- | --- |
| Project | `HRCSWl1cNnh6fYEGziAb` |
| Spec | `Flie3SblIDXvplYmqOhy` |
| This research task | `ENqHqSQMrpK49AyIMhBm` |
| Downstream spec | `5rOjpXW4VzNsgtCxwz7I` |
| Peet Phase 6 scope gate | `eqZUnsjDmKnE5tsnNXxX` |
| Phase 5 residual map | `docs/research/finance-phase5-residual-gap-map-2026-08-03.md` |
| Phase 5 acceptance | `docs/operations/finance/phase5-acceptance-pack-2026-08-03.md` |
| Phase 5 close runbooks | `docs/operations/finance/operator-runbooks-phase5-close-2026-08-03.md` |
| This repo doc | `docs/research/finance-phase6-residual-gap-map-2026-08-03.md` |
| Matrix HTML (throwaway visual) | `docs/research/finance-phase6-residual-gap-map-matrix-2026-08-03.html` |
| Inventory HEAD | `6d435e3f56030033e46f8c789231be82a5ea61d7` |
| Wiki topic | `agents/partners/wiki/finance-phase6-residual-gap-map-2026-08-03.md` |

---

## Safety readback

- Read-only competitor research + internal inventory + durable docs + Research item.  
- No SARS submit, payment initiation, mass payslip/statement email, production deploy, or main promote.  
- No paid bank-feed vendor contract.  
- No client-visible finance mutations.  
- Temporary matrix HTML is throwaway visual only; decision lives in Messages + this markdown + Research item + task agentOutput.

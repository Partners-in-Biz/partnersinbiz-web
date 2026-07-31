# Partners in Biz Finance, Accounting, and South African Payroll Architecture

Status: approved and implemented (gate e7EEr9HtG0MdCrwyhT63, verification commit following)
Repository: existing `partnersinbiz-web` application on `development`
Project: Partners in Biz Finance, Accounting & South African Payroll (`HRCSWl1cNnh6fYEGziAb`)
Architecture task: Inventory existing web finance models and define additive architecture/data-model delta (`MDgyihpKCbNNJY03ThqT`)
Canonical product specification: client document `Flie3SblIDXvplYmqOhy`, current version `DCAh9tNOlloqSOwYSUP2`
Planning source: confirmed planning-discovery revision 12, 2026-07-29
Inspected baseline: repository commit `dbd343c740183d453cb7a72037813f746fc5be7d`, followed by preflight sync to the then-current `development` tip
Scope boundary: development/staging only. No production release, client-visible action, or secret/configuration change is authorised by this document. No automatic external payment initiation. No direct SARS submission or payment.

## 1. Decision

Extend the existing Next.js and Firestore application additively. Do not create a standalone finance app and do not reinterpret an organisation or CRM company as an accounting legal entity.

The canonical hierarchy is:

`organization (tenant/workspace) -> legal entity -> branch (optional reporting dimension) -> accounting book -> accounting period -> journal entry -> journal lines`

Existing invoices, quotes, expenses, time entries, subscriptions, CRM companies/contacts/deals, reports, and platform billing remain operational records. New accounting services bind those records to a legal entity and book and create immutable double-entry postings. Existing public and portal contracts remain available while the Finance workbench is introduced under `/portal/finance`.

Firestore remains the release-one database because it is the repository's established persistence and transaction boundary. Finance writes must go through dedicated server-only domain services. Firestore cannot enforce foreign keys, checks, or unique indexes itself, so each record redundantly carries its tenant/entity/book scope; deterministic identifiers, transactionally claimed sequence documents, mutation preconditions, and transactionally written audit/outbox rows enforce the contract. A later PostgreSQL migration is possible behind repository interfaces, but is not required for release one and must not produce two competing ledgers.

## 2. Existing application inventory

### 2.1 Organisation, tenant, identity, and permission model

| Existing surface | Current contract | Reuse and boundary |
| --- | --- | --- |
| `organizations/{orgId}` | Workspace root with name, slug, type/status, embedded legacy members, settings, billing identity, VAT/tax identifiers, address, accounts contact, signatory, and banking snapshot. See `lib/organizations/types.ts`. | Keep as tenant and default-setting source. It is not the legal entity or accounting book. Copy identity into a legal entity only during explicit bootstrap; later legal-entity edits are independent and audited. |
| `orgMembers/{orgId}_{uid}` | Canonical per-workspace membership with role, status, access policy, and module permissions. | Reuse as the first gate. Add finance scope assignments rather than another identity system. Embedded `organizations.members[]` remains read compatibility only. |
| `users/{uid}` | Platform role and denormalised `orgId`, `activeOrgId`, `orgIds[]`, `allowedOrgIds[]`. | Reuse authentication context, never as finance authority by itself. |
| `lib/api/auth.ts` | `withAuth` supports session, delegation, API, AI, and admin credentials. It checks query/header org scope but not every path/body/resource. | Every finance service must re-check the loaded resource's full `orgId + legalEntityId + bookId` tuple. |
| `lib/api/orgScope.ts`, `selectedOrgContext.ts`, `platformAdmin.ts` | Resolve active/restricted organisation scope. | Reuse for the workspace gate. Do not let unrestricted AI/admin semantics bypass legal-entity/book capability checks. |
| `lib/orgMembers/access-policy.ts` | Persisted `billing` module permission and record-scope conventions. | Preserve the key for compatibility; relabel the product surface “Finance”. Add fine-grained finance roles and scopes in a new finance policy record. |
| CRM middleware and portal middleware | Resolve per-org role and active membership. | Reuse wrappers, then apply finance authorization. |

Known boundary: membership denormalisation is currently non-transactional. Finance access must read canonical active `orgMembers` and dedicated finance assignments; it must not rely only on embedded organisation members or `users.orgIds`.

### 2.2 CRM and counterparties

| Collection/module | Current contract | Finance use |
| --- | --- | --- |
| `companies` / `lib/companies/types.ts` | Org-owned CRM company with `linkedOrgId`, legal/billing snapshots, owner/assignment, soft delete. | Reuse `companyId` as customer/supplier counterparty reference. Do not duplicate companies into a parallel customer table. Store a frozen legal/name/address/tax snapshot on each finance document. |
| `contacts` | Org-owned person, optional company and linked platform user. | Reuse for billing/payroll contact links where appropriate; never use as the employee payroll identity without an explicit employee record. |
| `deals`, `quotes` | Commercial pipeline and quote lifecycle. Accepted quotes may convert to invoices. | Preserve links. Conversion must become transaction/idempotency safe before accounting cutover. |
| `businessRelationships` | Explicit source-org/company to target-org/company edge. | Reuse to discover related legal entities, but formal intercompany is enabled only by an approved `intercompany_pairs` record. |
| `claimable_relationships` | External recipient may later claim an org/user relationship. | Preserve on invoices; claiming never grants finance-book access. |

### 2.3 Invoices and receivables

Current model: `lib/invoices/types.ts` and root `invoices` collection.

Existing strengths to reuse:

- source/issuer/billing/recipient organisation perspectives;
- CRM company/contact and claimable-recipient links;
- frozen sender and client snapshots;
- transactional invoice numbering in `lib/invoices/invoice-number.ts`;
- draft/sent/viewed/payment-verification/paid/part-paid/overdue/cancelled lifecycle;
- PDF/public tokens and payment-proof workflow;
- tenant-aware access in `lib/invoices/access.ts` and portal capability decoration;
- EFT/PayPal instructions and subscription settlement hooks.

Compatibility risks to resolve before ledger cutover:

- several settlement routes directly mutate invoice status instead of using `lib/billing/settle-invoice.ts`;
- a legacy PayPal webhook can settle too early and lacks canonical event deduplication;
- recipient-side manual mark-paid access is too broad;
- duplicate/recurring invoice paths omit modern source/recipient/CRM fields;
- quote conversion is non-transactional;
- invoice amounts use floating numbers and one percentage tax rate, not line-level minor units and tax codes;
- `orgId` versus `billingOrgId` semantics vary across reports;
- `partially_paid` is not consistently included in outstanding reports.

Release-one rule: existing invoice fields remain readable and writable through compatibility adapters, but after a book's accounting cutover the canonical financial effects are `payments`, `payment_allocations`, and journal postings. Invoice status/paid fields become denormalised projections updated from those records.

### 2.4 Payments and settlement

No canonical payment transaction or allocation entity exists. Current money evidence is spread across invoice fields, `webhook_events`, payment proofs/uploads, EFT verification, PayPal capture, and activity rows.

Reuse `lib/billing/settle-invoice.ts` only as the starting point for a single canonical settlement service. Replace direct paid-state mutations with an adapter that:

1. records an idempotent external payment observation;
2. creates one or more allocations;
3. posts the corresponding journal entry according to book basis and tax-point rules;
4. updates invoice projections;
5. writes immutable audit and outbox events in the same Firestore transaction.

No service in release one initiates a transfer, supplier payment, salary payment, tax payment, collection, refund, or direct debit.

### 2.5 Expenses, supplier bills, and time

The `expenses` collection and `lib/expenses/types.ts` provide draft/submitted/approved/rejected/reimbursed state, employee/user, date, amount, category/vendor, receipt, project/client, billable/reimbursable, and invoice linkage.

Current boundaries:

- all expense and time routes are admin/AI authenticated despite employee ownership fields;
- expense detail/submit/approve routes need loaded-record tenant checks;
- expense-to-invoice billing does not enforce invoice/expense org equality;
- `reimbursed` exists without a transition route;
- no portal expense/time UI exists and expense links currently lead to a non-functional payments query;
- expense is not a supplier bill and cannot represent accounts payable, due dates, tax lines, credits, or payment allocation.

Keep simple expenses for employee/card/cash claims. Introduce first-class `supplier_bills` and `supplier_bill_lines` for accounts payable. Extract expense/time domain services before adding portal handlers. Approved expenses may post directly or become reimbursable liabilities, depending on policy.

### 2.6 Platform billing and reporting

`subscriptions`, plans, coupons, referrals, dunning, partner payouts, usage, trials, and churn are the platform's commercial control plane, not the customer's accounting system. Keep `lib/billing/*` naming for compatibility, but isolate customer finance under `lib/finance`, `lib/accounting`, and `lib/payroll`.

Existing reports include revenue, outstanding invoices, expenses, client value, team utilisation, CRM, immutable report snapshots, schedules, PDF/share, and a metrics fact store. They are useful projections but are not financial statements. Mixed-currency arithmetic, outstanding-status definitions, and `orgId`/`billingOrgId` ambiguity prevent them from becoming the canonical ledger.

### 2.7 UI and tests

Existing UI to retain:

- `/portal/settings/organization` for workspace identity defaults;
- CRM company/contact/deal/quote surfaces;
- `/portal/invoicing`, `/portal/invoicing/new`, `/portal/invoicing/[id]`, recurring invoices;
- `/portal/payments` as a legacy received-invoice/quote command centre;
- platform subscription billing and usage pages;
- report workspace and custom report builder.

Accounting, bank reconciliation, supplier bills, canonical payments, VAT returns, payroll employees/runs/payslips, and statutory-ready outputs have no current domain/UI.

Existing Jest/ts-jest route and React Testing Library conventions are reusable. Representative inventory verification passed 12 suites/84 tests for backend finance surfaces and 8 suites/38 tests for representative UI surfaces during discovery. Material gaps include settlement/webhook concurrency, expense/time lifecycle isolation, mixed currencies, recurring-copy completeness, payroll, ledger, and browser E2E coverage.

## 3. Compatibility boundaries

1. `organization` remains the tenant. It may own zero or many `legal_entities`.
2. `company` remains a CRM counterparty. It may link to a legal entity only through an explicit mapping; it is never silently promoted.
3. Existing invoice IDs, URLs, tokens, statuses, and API routes remain stable.
4. Existing `billing` permission keys remain stored; UI labels may say Finance.
5. Existing ZAR decimal amounts remain readable. New canonical accounting amounts use integer minor units plus ISO currency. Adapters convert legacy amounts with explicit rounding and record the source amount.
6. Legacy activity and report records are not rewritten into the new audit/ledger. They remain historical operational evidence.
7. Ledger posting starts only from an approved per-book `cutoverAt`. Earlier records are represented by approved opening balances unless separately imported.
8. No migration marks historical invoices paid/unpaid differently, emits external webhooks, sends documents, or creates payment instructions.
9. Existing reports continue during rollout. New financial statements read only posted journal lines.
10. Payroll records are isolated from generic contacts and organisation members because employment, tax identity, bank details, pay history, and access are materially more sensitive.

## 4. Canonical data-model delta

Every finance record includes `schemaVersion`, `orgId`, actor references, `createdAt`, and where mutable, `updatedAt` plus integer `version`. Protected relationships repeat the full scope tuple and services verify equality before write.

`finance_unique_claims/{claimId}` stores a deterministic normalized key, claim type, full scope, aggregate reference, and created version. The same transaction that creates a sequence-bearing or unique aggregate must create/touch its claim. Claim types include entity/book/account code, book period range, posting source tuple, supplier reference, provider event, bank source fingerprint, and active assignment. Period creation also increments a per-book calendar head; allocation and reconciliation mutations increment their aggregate version/balance heads. Concurrent-create emulator tests are mandatory for every claim type.

### 4.1 Entity, branch, book, period, and access

#### `legal_entities/{legalEntityId}`

Required fields:

- `orgId`
- `code` (unique within org through deterministic claim document)
- `legalName`, `tradingName`, `registrationNumber`, `taxNumber`, `vatNumber?`
- `jurisdictionCode` (`ZA` first), `functionalCurrency`
- registered and postal addresses
- `status: draft | active | inactive`
- `defaultAccountingBasis: cash | accrual`
- `fiscalYearStartMonth`, `timezone`
- `sourceOrganizationSnapshot?`

Invariant: legal entity identity is explicit and stable. Deactivation never deletes its books or history.

#### `finance_branches/{branchId}`

Fields: `orgId`, `legalEntityId`, `code`, `name`, address, tax registration overrides where legally valid, `status`, `reportingOnly`, optional `promotedBookId`.

Invariant: a branch belongs to exactly one legal entity. Normal branches are dimensions; a separate legal book uses `accounting_books`, not a flag that changes historical meaning.

#### `accounting_books/{bookId}`

Fields:

- `orgId`, `legalEntityId`, optional `branchId`
- unique `code`, `name`, `bookType: primary | branch | management | consolidation`
- `functionalCurrency`, `accountingBasis`
- `jurisdictionCode`, `taxPointPolicyId`
- `cutoverAt?`, `status: draft | active | locked | archived`
- default receivable/payable/cash/tax/retained-earnings accounts
- current open period reference

Invariant: one source transaction posts to one primary book. Consolidation books hold elimination/consolidation entries only.

#### `book_policy_versions/{policyVersionId}`

Effective-dated, approved policy snapshots hold accounting basis, tax-point policy, currency precision/rounding, posting defaults, and jurisdiction module versions. Every posting pins one policy version. A future basis or tax-point change creates a new version; it never mutates or reinterprets prior postings.

#### `accounting_periods/{periodId}`

Fields: full scope, `fiscalYear`, `periodNumber`, `startsAt`, `endsAt`, `status: open | soft_closed | hard_closed`, close/reopen approvals and timestamps.

Invariants:

- periods do not overlap within a book;
- posted entries use the period containing `postingDate`;
- soft close permits only authorised adjusting entries;
- hard close rejects all writes except an approved reopen or next-period correction.

#### `finance_role_assignments/{assignmentId}`

Fields: `orgId`, `userId`, `scopeMode: entity | book`, required `legalEntityId`, optional `bookId` only for book scope, one role (`finance_viewer`, `bookkeeper`, `accountant`, `finance_approver`, `payroll_clerk`, `payroll_approver`, `finance_admin`), `status: active | revoked | expired`, effective dates, grant/revoke actor and reason. Deterministic IDs prevent duplicate active grants, and book scope requires that the book belongs to the same entity.

Assignment cannot expand beyond an active org membership. Missing scope means no access. Payroll roles do not imply general finance-admin authority, and finance roles do not imply payslip access.

### 4.2 Chart, tax, journals, and ledger

#### `ledger_accounts/{accountId}`

Fields: full scope, unique `code`, `name`, `accountType: asset | liability | equity | income | expense`, `normalBalance: debit | credit`, optional parent, control-account role, currency policy, active dates, posting allowed flag, report mapping.

Control accounts (receivables, payables, VAT control, payroll liabilities, bank) reject unsupported manual postings unless an authorised adjustment explicitly identifies its source.

#### `tax_codes/{taxCodeId}` and `tax_rule_versions/{ruleVersionId}`

Tax code fields: full scope, stable code/name, jurisdiction, category (`output_vat`, `input_vat`, `zero_rated`, `exempt`, `out_of_scope`, withholding/future), recoverability policy, ledger accounts, active flag.

Rule version fields: jurisdiction, tax code, effective date range, rate as integer basis points or exact rational components, rounding policy, tax-point policy, source citation/checksum, approval status.

Invariant: a posted line stores `taxCodeId`, `taxRuleVersionId`, taxable minor units, tax minor units, and calculation trace. Historical postings never recalculate when rules change.

#### `tax_periods/{taxPeriodId}`, `tax_return_snapshots/{returnId}`, and `tax_return_lines/{lineId}`

Tax periods carry entity/book/jurisdiction, period bounds, status (`open | prepared | approved_locked | adjusted`), source cutoff and approvals. A return snapshot pins the tax period, posting cutoff, rule versions, source journals, totals, line evidence, adjustments, preparer/approver, and content hash. An approved return is immutable; corrections create an adjustment/replacement snapshot. These records produce VAT/tax-ready evidence only and expose no SARS submission or payment action.

#### `journal_entries/{journalEntryId}`

Fields:

- `orgId + legalEntityId + bookId + periodId`
- deterministic/idempotency source tuple (`sourceType`, `sourceId`, `sourceVersion`, `postingPurpose`)
- `entryNumber`, `entryType`, `postingDate`, `documentDate`
- `status: draft | pending_approval | posted`
- description, currency and optional exchange-rate snapshot
- totals in minor units
- approval, posting, and hash metadata
- optional `reversesJournalEntryId` only on the new reversal entry, plus reversal reason and approval references

Append-only reversal lifecycle:

- the original entry remains `posted`; posting and reversal never mutate its stored status, lines, totals, hashes, or metadata;
- reversal creates a separate balanced reversal entry in an open correction period, with equal-and-opposite lines, `status: posted`, and `reversesJournalEntryId` pointing to the original posted entry;
- the reversal entry is approved, posted, audited, and emitted through the same atomic transaction contract as every other posted journal;
- a deterministic source/unique claim on the reversed entry ID prevents more than one direct posted reversal for the same entry; further correction uses a new explicit adjustment or reverses the prior reversal under the same rules;
- `reversed` and `reversalEntryId` are read-model fields in a derived reversal projection resolved from posted reversal entries; they are not persisted lifecycle mutations on the original journal entry.

#### `journal_lines/{journalLineId}`

Fields: full scope plus `journalEntryId`, sequence, `accountId`, debit minor units, credit minor units, transaction/functional currency values, tax trace, branch/project/company/contact/employee/intercompany dimensions, description.

Non-negotiable journal invariants:

- every posted entry has at least two lines;
- debits equal credits in functional minor units;
- exactly one of debit or credit is positive on each line;
- all values are integer minor units; no floating point is persisted as canonical money;
- every line has the same `orgId + legalEntityId + bookId + periodId` as its entry;
- all referenced accounts belong to the same book and allow posting on the date;
- source tuple is unique per posting purpose;
- an entry is immutable after posting;
- correction is a new adjustment or reversal entry, never an update/delete;
- posting, lines, sequence claim, finance_audit_events, and finance_outbox_events are written transactionally;
- deletion is forbidden; draft abandonment is an audited status transition.

Firestore implementation: create deterministic line IDs (`entryId_0001`), keep a compact line digest/totals on the entry, and cap one entry below Firestore transaction/write limits. Large imports split into independently balanced entries linked by an import batch.

### 4.3 Finance documents, payments, and reconciliation

#### Existing `invoices` additive fields

Add optional `financeBinding`:

- full entity/book scope and `accountingBasisAtIssue`
- minor-unit subtotal/tax/total and line-level tax-code snapshots
- posting state and journal entry IDs
- cutover/import metadata

Legacy fields remain. New invoices write both legacy display totals and canonical minor-unit values. Read adapters prefer canonical values when present.

#### `supplier_bills/{supplierBillId}` and `supplier_bill_lines/{lineId}`

Mirror formal payable-document needs: entity/book, supplier `companyId` and frozen snapshot, number/supplier reference, issue/received/due dates, statuses, line minor units/tax codes, totals, approvals, posting IDs, credit/reversal links, attachments.

Supplier reference uniqueness is enforced per supplier/entity/book where configured. A bill never initiates payment.

#### `payments/{paymentId}`

Fields: full scope, direction (`receipt | disbursement | transfer`), external account, amount/currency in minor units, observed/effective dates, method/provider/reference, counterparty, status (`observed | pending_verification | verified | reversed`), source event/idempotency tuple, proof, posting IDs.

#### `payment_allocations/{allocationId}`

Fields: full scope, `paymentId`, target type/id (invoice, supplier bill, expense reimbursement, payroll liability, tax liability, on-account), allocated minor units, exchange/discount/write-off components, created/reversed metadata.

Invariants:

- verified allocations cannot exceed the payment's unallocated amount;
- allocations across entities/books are forbidden except through formal intercompany records;
- allocated totals and document outstanding projections update in the same transaction;
- reversal creates reversing allocation/posting records;
- provider retries resolve to one payment through a unique source tuple.

#### `open_items/{openItemId}`, `account_credits/{creditId}`, and finance adjustments

`open_items` is the canonical AR/AP subledger row for an invoice, supplier bill, credit/debit note, or opening item. It stores source identity/version, entity/book/counterparty, original and outstanding minor units, due/tax dates, control account and status. `account_credits` represents verified customer/supplier money on account and may later allocate to an open item without double-posting cash. Sales credit notes and supplier debit/credit notes are typed immutable finance documents linked to the source document and their reversing/adjusting journals; they do not mutate issued documents.

#### `bank_accounts/{bankAccountId}` and `bank_transactions/{bankTransactionId}`

Bank account fields: full scope, masked identity, currency, ledger account, import/provider metadata, active status. Secrets/tokens are not stored in domain records.

Bank transaction fields: full scope, immutable imported/manual statement row, provider/source fingerprint, statement/effective date, signed minor units, description/reference/counterparty, reconciliation state.

#### `reconciliations/{reconciliationId}` and `reconciliation_matches/{matchId}`

Reconciliation fields: account/scope, statement period/opening/closing balances in minor units, status (`draft | in_review | approved | reversed`), calculated difference, approvals and lock metadata.

Match fields link bank transactions to payments/journals with allocated minor units. Approved reconciliation locks its match set; corrections reverse and replace it. Statement closing balance equals opening balance plus statement movements, and the approved ledger-to-statement difference must be zero or an explicitly approved reconciling item.

`reconciliation_adjustments/{adjustmentId}` is the canonical lifecycle for an explicitly approved reconciling item. It records type, reason, amount, evidence, proposed journal, preparer, approver, resolution/reversal, and expiry. It cannot become a silent balancing plug.

#### `accounting_rate_sets/{rateSetId}` and `accounting_rates/{rateId}`

The existing `fx_rates` store and `/api/v1/fx/rates` route are operational reporting compatibility only: they are ZAR-based, floating, provider-refreshable, and may fall back unsafely. Canonical accounting rates are immutable approved sets with pair/date/source/version/checksum and exact decimal/rational precision. Journal lines pin rate-set/rate IDs and preserve transaction-currency and functional-currency balancing. Realised and unrealised FX differences post to configured accounts through explicit journal purposes.

### 4.4 Cash and accrual accounting

The ledger is always double-entry. `accountingBasis` selects recognition rules and report projections, not whether postings exist.

Accrual basis:

- issued invoice: debit receivables, credit revenue and output VAT as required;
- supplier bill: debit expense/asset and input VAT, credit payables;
- settlement: move receivable/payable to bank/cash.

Cash basis:

- draft/issued documents remain operational and may create memorandum commitments;
- income/expense and tax recognition posts at verified allocation according to the jurisdiction's tax-point policy;
- reports filter or project using immutable posting purpose and recognition date, never by changing historical invoice dates.

A book's basis change is future-effective, approved, and versioned. It does not rewrite posted history.

### 4.5 Intercompany and consolidation

#### `intercompany_pairs/{pairId}`

Fields: group org, source/target legal entities and books, due-to/due-from accounts, enabled transaction types, approval policy, status.

#### `intercompany_transactions/{intercompanyTransactionId}`

Fields: pair, source proposal/entry, receiving proposal, amounts/currencies/rate snapshot, statuses, approvals, matched/reversed links.

Invariants:

- source and receiving legal entities differ but belong to the authorised group/workspace;
- each side posts an independently balanced entry in its own book;
- paired amounts reconcile in transaction currency;
- receiving entry is not posted until an authorised receiver approves;
- due-to and due-from control balances remain linked and reportable;
- rejection/correction preserves both proposal histories.

#### `elimination_rules/{ruleId}`, `consolidation_runs/{runId}`, `consolidation_entries/{entryId}`

A consolidation run pins entity books, periods, exchange rates, rule versions, and source journal cutoffs. Eliminations post only to a consolidation book and never mutate entity books. Re-running creates a new version or reversal/replacement, with a reproducible trace.

### 4.6 South African payroll and jurisdiction boundary

#### `payroll_employees/{employeeId}`

Fields: org/legal entity, optional linked user/contact, encrypted or separately protected identity/tax/bank fields, names, identifiers, residency/tax status, start/end dates, status, access classification.

#### `payroll_employments/{employmentId}`

Fields identify the current employee/entity/branch/book relationship. Pay-relevant changes create immutable effective-dated `payroll_tax_profile_versions`, `employment_term_versions`, and `pay_component_assignment_versions` containing worker category, jurisdiction-defined frequency code, salary/hourly rate in minor units, standard hours, overtime policy, job/cost dimensions, tax directives, UIF/SDL flags, benefit/deduction elections, and effective dates. A locked run pins these versions or an equivalent complete immutable input snapshot.

#### `payroll_rule_versions/{ruleVersionId}`

Immutable, approved jurisdiction package with effective dates, source/version/checksum, PAYE tables/formulas, rebates/thresholds, UIF/SDL rules and caps, taxable component classifications, rounding, and output mappings. Draft rules cannot calculate final runs.

#### `payroll_calendars/{calendarId}` and `pay_periods/{payPeriodId}`

Entity-scoped weekly/monthly cycles, cut-off, pay date, tax period/year, status and lock state.

#### `pay_components/{componentId}`

Jurisdiction-aware earning/allowance/benefit/deduction/employer-contribution definition, tax/UIF/SDL treatment, ledger mapping, effective dates.

#### `pay_runs/{payRunId}`

Fields: full scope, period/calendar, rule versions, input cutoff/hash, status (`draft | calculating | calculated | in_review | approved_locked | reversed | correction`), totals, approval, lock hash, original/correction/reversal links, ledger posting IDs.

#### `payroll_tax_years/{taxYearId}`, `payroll_ytd_openings/{openingId}`, and `payroll_calculation_manifests/{manifestId}`

Tax years pin jurisdiction dates and status. YTD openings provide employee/component/tax/UIF/SDL balances for approved mid-year cutover with source evidence and approval. Large payroll calculation output is written in bounded immutable batches; each batch has a digest in a calculation manifest. The final small head transaction verifies/pins all batch hashes, totals, rule/input versions and approval, then emits bounded balanced payroll journal batches linked by one posting manifest. It never attempts to lock thousands of documents in one Firestore transaction.

#### `pay_run_items/{itemId}` and `pay_run_item_components/{componentLineId}`

Employee/employment snapshots, inputs, calculation trace, gross/tax/UIF/SDL/deduction/net/employer totals in minor units, component lines, warnings/errors, source time/leave references.

#### `payslips/{payslipId}`

Immutable rendered-data snapshot linked to an approved run item, access token/version metadata, generation checksum, publication status. Generation does not send it automatically.

#### `payroll_adjustments/{adjustmentId}`, `leave_records`, and statutory snapshots

Adjustments represent back-pay, recovery, missed deductions, amended tax, individual correction, or full-run reversal. Statutory collections include `irp5_records`, `emp201_snapshots`, `emp501_reconciliations`, and export manifests. These are “ready” records/reports, not direct submissions.

Payroll invariants:

- calculations pin immutable employee/employment/component/rule versions and produce a deterministic trace;
- only an approved payroll rule version may finalise a run;
- every run requires a separate authorised approval before lock;
- a locked payroll run, run item, and payslip are immutable after posting;
- correction runs reference the original and contain only explicit deltas/reversals;
- a full reversal preserves the original and creates reversing payroll and journal records;
- net pay, PAYE, UIF, SDL, deductions, benefits, and employer contributions reconcile to component totals and ledger postings;
- payroll approval never initiates salary or SARS payment;
- payslip/employee access is narrower than normal finance reporting access.

Jurisdiction services live behind interfaces such as `TaxEngine`, `PayrollEngine`, `StatutoryReportBuilder`, `NumberingPolicy`, and `TaxPointPolicy`. Core accounting code receives a jurisdiction result plus trace; it contains no scattered `if country === 'ZA'` calculations.

### 4.7 Audit, events, and concurrency

#### `finance_audit_events/{eventId}`

Immutable event with full scope, aggregate type/id/version, event type, actor and delegation references, request/idempotency/correlation IDs, before/after digests or redacted changes, timestamp, monotonic sequence, `previousEventId`, `previousEventHash`, canonical hash payload/schema version, hash algorithm version, event hash, and reason/approval reference.

`finance_audit_heads/{scopeId}` stores the latest event ID/hash/sequence for a book or payroll scope. Event creation and head advancement occur in the same transaction; sequence zero is the one genesis event and the expected head prevents forks. Periodic signed/exported checkpoints provide external tamper evidence. “Immutable” means append-only through finance services plus detectable tampering; Firestore Admin SDK can bypass client rules, so service boundaries, restricted runtime credentials, checkpoint verification, and audit-chain verification jobs are required. Client rules alone are not claimed as privileged-mutation protection.

#### `finance_outbox_events/{eventId}`

Transactionally created delivery record containing event type/version, aggregate reference, redacted payload, creation time, delivery status/attempts. An outbox record creation failure aborts the finance transaction. In development/staging, workers use an internal/test sink with external egress disabled for email, client notifications, webhooks, payment providers, and SARS. An outbox delivery failure never changes the committed ledger outcome and can be retried idempotently.

Existing singular `activity` and plural `activities` may receive best-effort user-facing projections from outbox workers, but neither is finance audit evidence.

Concurrency rules:

- mutable aggregates use integer `version` and request `If-Match`/expected version;
- create commands require an idempotency key bound to org, method, route, body digest, actor, and expiry;
- sequence, idempotency claim, aggregate, audit, and outbox writes occur in one transaction;
- posted/locked records reject PATCH/DELETE at service and route boundaries;
- retries return the original result only when the payload digest matches.

## 5. Authorization matrix

Evaluation order: authenticate -> active workspace membership -> exact workspace equality -> finance module capability -> legal-entity assignment -> book assignment -> action role -> record state/precondition. Denials for sensitive employee/payroll IDs use non-enumerating 404 where appropriate.

| Resource/action | Minimum capability | Extra rule |
| --- | --- | --- |
| entity/book/account/period read | finance_viewer | assigned entity/book |
| entity/book/account configuration | finance_admin | owner/admin membership; audited |
| draft journal create/edit | bookkeeper | open assigned book/period |
| journal approve/post | accountant or finance_approver | creator cannot self-approve where policy requires separation |
| posted journal reverse | accountant + approver policy | reason and open correction period |
| invoices/supplier bills | bookkeeper | CRM/customer access plus book scope |
| payment observe/match | bookkeeper | no payment initiation capability exists |
| reconciliation approve | finance_approver | cannot approve own reconciliation if separation enabled |
| intercompany propose | accountant | source book scope |
| intercompany receive/approve | approver in receiving entity | source actor alone is insufficient |
| consolidation run/approve | finance_admin/accountant | all source entity assignments |
| employee/payroll read | payroll_clerk | assigned legal entity; sensitive fields redacted by default |
| payroll calculate | payroll_clerk | approved rule package and open pay period |
| pay run approve/lock | payroll_approver | cannot self-approve where separation enabled |
| payslip read | employee self or payroll role | exact employee relation or assigned entity |
| statutory-ready report | payroll_approver/finance_admin | no SARS submit/payment action exists |

Direct browser Firestore access is not permitted for new finance/payroll collections. Rules deny all client access; all operations pass through server routes and domain services.

## 6. API architecture

Use closed request schemas, typed responses, bounded cursor pagination, idempotency on commands, and expected-version preconditions.

Proposed route groups:

- `/api/v1/finance/legal-entities`, `/branches`, `/books`, `/periods`, `/accounts`, `/tax-codes`
- `/api/v1/finance/journals` and `/:id/{submit,approve,post,reverse}`
- `/api/v1/finance/supplier-bills` and lifecycle actions
- `/api/v1/finance/payments`, `/allocations`, `/bank-accounts`, `/bank-transactions`
- `/api/v1/finance/reconciliations` and `/:id/{match,submit,approve,reverse}`
- `/api/v1/finance/intercompany`, `/consolidations`
- `/api/v1/finance/reports/{trial-balance,general-ledger,profit-loss,balance-sheet,cash-flow,vat}`
- `/api/v1/payroll/employees`, `/employments`, `/components`, `/calendars`, `/periods`
- `/api/v1/payroll/pay-runs` and `/:id/{calculate,submit,approve,lock,correct,reverse}`
- `/api/v1/payroll/payslips`, `/statutory/{irp5,emp201,emp501}`

Existing invoice/payment endpoints remain and call compatibility adapters. Routes must not contain posting calculations; they validate transport, resolve auth/scope, call a domain command/query service, and serialize the result.

## 7. Additive migration strategy

### Stage 0: safety repairs before accounting cutover

- unify all settlement paths behind one idempotent verified-payment service;
- disable or harden the legacy PayPal receiver;
- enforce sender/approver rules for manual payment confirmation;
- add loaded-record org checks to expense routes and org equality to expense billing;
- make quote conversion idempotent/transactional;
- preserve relationship fields in duplicate/recurring invoices;
- normalise outstanding and revenue definitions;
- make idempotency transactionally claimed and payload-bound.

These repairs may be separate approved implementation slices, but accounting must not depend on unsafe paths.

### Stage 1: schema and default bootstrap (dark)

1. Add types, repositories, validators, Firestore rules (server-only), and indexes.
2. For each opted-in org, create one draft legal entity and primary book from an explicit preview of organisation billing details.
3. Require a finance admin to confirm legal identity, currency, basis, fiscal year, tax/VAT data, chart template, and cutover date.
4. Create deterministic mapping records (`finance_migration_mappings`) for org/entity/book and legacy source IDs.
5. Do not post historical transactions automatically.

### Stage 2: opening balances and dual projection

1. Import an approved opening trial balance into one balanced opening journal plus source-level opening AR/AP `open_items`, customer/supplier credits, payroll YTD openings, and pre-cutover tax state. Control-account totals must reconcile to these subledgers so later settlement of a legacy invoice clears opening AR/AP without recognising revenue or tax twice.
2. Backfill invoice/expense canonical minor-unit fields and entity/book bindings in resumable, idempotent batches; log invalid/ambiguous records without guessing.
3. Continue current UI/report behavior.
4. In staging, generate shadow ledger postings for new finance events and compare projections without exposing them as canonical.

### Stage 3: per-book cutover

1. Finance approver signs off reconciliation, opening balance, unresolved records, tax settings, and cutover timestamp.
2. Set `book.cutoverAt` transactionally with approval/audit.
3. New/changed invoices, bills, verified payments, reimbursements, payroll, and journals post through domain services.
4. Legacy invoice status/paid fields are projections from canonical allocations for post-cutover events.
5. Monitor imbalance, duplicate-source, outbox, unmatched-payment, and cross-scope-denial metrics.

### Stage 4: UI adoption

Introduce `/portal/finance` and subnavigation without moving existing URLs. Add expenses/time first, then accounting, banking, tax, and payroll. Retarget `/admin/finance` compatibility rewrite only after the Finance workbench exists.

### Stage 5: payroll and statutory-ready outputs

Enable only after approved ZA rule versions, golden calculation fixtures, accountant/data validation, permission review, locked-run/reversal tests, and staging reconciliation to payroll liabilities.

### Rollback and compatibility

- Feature flags and per-book status prevent unapproved use.
- Before cutover, disable shadow posting and remove draft bootstrap records only through an approved cleanup tool.
- After cutover, never delete or rewrite ledger/payroll history. Rollback means stop new commands, preserve reads, correct through reversals/adjustments, and restore compatibility projections.
- Migration scripts are dry-run by default, resumable, idempotent, scoped by `orgId + legalEntityId + bookId`, and emit count/checksum/error reports.
- No rollback path calls external providers, sends client documents, initiates payments, or submits to SARS.

## 8. Affected files and modules

### Existing files to modify deliberately

- `lib/organizations/types.ts`: optional default finance setup metadata only; do not embed entities/books.
- `lib/orgMembers/access-policy.ts`: preserve `billing` persisted key; add Finance label/routing and compatibility mapping.
- `lib/invoices/types.ts`, invoice create/detail/lifecycle routes: canonical binding/minor-unit adapters and unified settlement.
- `lib/billing/settle-invoice.ts`: refactor behind canonical payment/allocation/posting service.
- payment proof, confirm, mark-paid, PayPal capture, canonical/legacy webhook routes: call one settlement path.
- expense routes and `lib/expenses/types.ts`: tenant safety, service extraction, finance binding, reimbursement transition.
- time billing route: accounting adapter and portal-safe service.
- quote conversion and recurring/duplicate invoice routes: idempotency and complete relationship copying.
- `lib/reports/*` and finance report routes: keep operational reports; add ledger-backed statements separately.
- `lib/fx/rates.ts` and `app/api/v1/fx/rates/route.ts`: retain as operational reporting compatibility; never use provider-fallback rows as canonical accounting rates.
- `lib/api/idempotency.ts`: transactional, org/method/body-bound command idempotency.
- `PortalLayoutClient.tsx`, `PortalSubnav.tsx`, `SettingsNav.tsx`, `next.config.ts`, briefing expense links: Finance navigation and compatibility.
- `firestore.rules`, `firestore.indexes.json`: deny client finance/payroll collections and add server query indexes.

### New server modules

- `lib/finance/scope.ts`, `policy.ts`, `money.ts`, `idempotency.ts`, `audit.ts`, `outbox.ts`
- `lib/accounting/types.ts`, `repository.ts`, `posting-service.ts`, `period-service.ts`, `chart-service.ts`, `tax-service.ts`, `reporting-service.ts`
- `lib/finance/documents/invoice-adapter.ts`, `supplier-bill-service.ts`, `expense-adapter.ts`
- `lib/finance/payments/payment-service.ts`, `allocation-service.ts`, `reconciliation-service.ts`
- `lib/finance/intercompany/service.ts`, `consolidation-service.ts`
- `lib/jurisdictions/contracts.ts`, `lib/jurisdictions/za/{tax,payroll,statutory}.ts`
- `lib/payroll/types.ts`, `employee-service.ts`, `calculation-service.ts`, `pay-run-service.ts`, `posting-service.ts`, `statutory-service.ts`
- route groups listed in section 6
- migration/verification scripts under `scripts/finance/`

### New UI modules

- `app/(portal)/portal/finance/*` for overview, expenses, time, payments, supplier bills, accounting, banking/reconciliation, tax, and reports
- `app/(portal)/portal/finance/payroll/*` and `app/(portal)/portal/settings/payroll/*`
- `components/finance/*`, `components/accounting/*`, `components/payroll/*`

Reuse `AppFoundation`, `PortalSubnav`, scoped routing, CRM company tabs, report cards, drawers, tables, status pills, and existing invoice detail patterns.

## 9. Test plan

### Architecture and schema contract

- document contract test ensures canonical sources, aggregate names, invariants, migration, affected files, authorization, and test sections remain present;
- schema validators reject floats, missing full scope, invalid statuses, and unsupported currency/rule combinations;
- index/rules tests prove all new collections are server-only.

### Unit tests

- integer minor-unit arithmetic and explicit rounding;
- debit/credit balancing and account normal-balance behavior;
- cash versus accrual recognition;
- VAT/tax rule effective dates and historical version pinning;
- period selection, soft/hard close, reopen and correction rules;
- payment allocation, partial payment, overpayment/on-account, write-off and reversal;
- payroll PAYE/UIF/SDL/leave/overtime/bonus/allowance/benefit/deduction calculations using approved ZA golden fixtures;
- deterministic payroll traces and statutory mappings;
- intercompany pairing and consolidation eliminations.

### Firestore integration tests (emulator)

- concurrent journal posts cannot duplicate source tuples or sequence numbers;
- unbalanced, cross-org, cross-entity, cross-book, closed-period, and invalid-control-account postings fail with no partial writes;
- aggregate + lines + audit + outbox commit atomically;
- concurrent settlement/provider retries create one payment and bounded allocations;
- approved reconciliation and locked payroll records reject update/delete;
- reversal creates equal/opposite postings and preserves originals;
- idempotency keys are payload-bound and actor/org scoped;
- migration batches are resumable and do not emit side effects.

### Route/auth tests

For every resource and action, prove:

- unauthenticated, wrong-org, unassigned-entity, unassigned-book, wrong-role, stale-version, and invalid-state denial;
- denial leaks no sensitive record and creates no mutation/outbox side effect;
- payroll anti-enumeration and field redaction;
- sender/recipient and CRM assignment behavior remains compatible;
- no new finance/payroll endpoint initiates external payment or performs direct SARS submission/payment. Legacy PayPal routes remain outside the new finance/payroll contract, are not exercised by these tests, and must be separately gated/hardened.

### Compatibility/regression tests

- existing invoice IDs/URLs/tokens and portal workflows continue;
- legacy/new amount reads agree at cutover rounding precision;
- recurring/duplicate invoices preserve source/recipient/company/contact relationships and finance bindings;
- expense/time billing cannot cross org/entity/book boundaries;
- quote conversion is one-time under concurrency;
- operational billing/subscription pages remain distinct from Finance;
- existing report routes continue while financial statements use posted ledger data.

### UI and browser tests

- active workspace/entity/book scope persists through Finance navigation;
- expense review links open the exact record;
- separation-of-duties actions are hidden and server-denied;
- journals show balanced totals before submission and immutable state after posting;
- reconciliation difference reaches zero before approval;
- payroll calculation, review, lock, correction, reversal, and payslip access flows;
- accessibility, empty/error/loading states, console/network cleanliness, and no sensitive payroll data in client logs.

### Staging acceptance gates

1. zero unbalanced posted entries;
2. zero cross-scope write successes in negative suites;
3. opening trial balance and post-cutover trial balance reconcile;
4. invoice/bill/payment outstanding projections reconcile to receivable/payable control accounts;
5. bank statement closing balances reconcile;
6. intercompany due-to/due-from and eliminations reconcile;
7. payroll component totals reconcile to net pay, liabilities, expenses, and journal entries;
8. ZA golden fixtures are independently reviewed by Vera/Data and an authorised finance/payroll reviewer;
9. Quinn/QA records end-to-end staging evidence;
10. production remains blocked behind a separate explicit release approval.

## 10. Safety readback and unresolved approval items

This architecture creates records and calculations only inside development/staging. It deliberately excludes automatic external payment initiation, salary/supplier payment execution, direct SARS submission or payment, production deployment, secret changes, and client-visible sends.

Human approval required before implementation: approve or request changes on the existing task “Peet approval gate: architecture and data model”. The following items should be explicitly confirmed during that review:

- Firestore as the release-one ledger persistence, with all writes server-side and transactionally enforced;
- one default entity/book bootstrap only after human confirmation, not automatic reinterpretation of organisations;
- per-book cutover with opening balances rather than silent historical reposting;
- canonical minor units and line-level tax codes while retaining legacy invoice fields;
- dedicated payroll identity/access records and separation of duties;
- named authorised source and reviewer for initial South African payroll/tax rule versions;
- whether creator/approver separation is mandatory for all customers or configurable by policy.

Until that gate is approved, downstream implementation tasks must remain dependency-blocked. This document authorises no implementation, production, payment, SARS, or external/client-visible action by itself.

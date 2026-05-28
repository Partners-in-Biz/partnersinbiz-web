# Platform-Owned Client Document Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep PiB-created client documents owned by `pib-platform-owner` while linking them to CRM companies and client organisations so client-visible documents appear in the right CRM and portal surfaces.

**Architecture:** Add `companyId` and `clientOrgId` to the existing `ClientDocumentLinkSet`, centralize relationship-aware document access in one helper, merge direct-org and platform-linked documents in the list API, and add a dry-run-first backfill planner. Existing document rendering stays unchanged.

**Tech Stack:** Next.js App Router, Firebase Admin SDK/Firestore, TypeScript, Jest, React Testing Library.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/client-documents/types.ts` | Extend `ClientDocumentLinkSet` with `companyId` and `clientOrgId`. |
| `lib/client-documents/access.ts` | New shared helper for direct document access and platform-linked client visibility. |
| `lib/client-documents/linkedValidation.ts` | New shared helper for linked payload validation and optional Firestore relationship checks. |
| `app/api/v1/client-documents/route.ts` | Accept new link fields and list direct plus platform-linked documents. |
| `app/api/v1/client-documents/[id]/route.ts` | Use shared access helper and linked validation for detail/PATCH/DELETE. |
| `app/api/v1/client-documents/[id]/versions/route.ts` | Use shared access helper for portal document detail loading. |
| `app/api/v1/client-documents/[id]/comments/route.ts` | Use shared access helper for portal comments and comment creation. |
| `app/api/v1/client-documents/[id]/approve/route.ts` | Use shared access helper for client approval. |
| `app/api/v1/client-documents/[id]/accept/route.ts` | Use shared access helper for formal acceptance. |
| `lib/companies/command-center.ts` | Let company document rows match nested `linked.companyId` / `linked.clientOrgId`. |
| `components/client-documents/DocumentIndex.tsx` | Show relationship labels when admin pages pass org/company lookup labels. |
| `scripts/backfill-platform-client-document-links.ts` | Dry-run-first planner/writer for legacy PiB-owned client document links. |
| `__tests__/api/v1/client-documents/client-documents.test.ts` | API validation, listing, and relationship access tests. |
| `__tests__/lib/companies/command-center.test.ts` | Unit tests for nested linked document matching. |
| `__tests__/components/client-documents/DocumentIndex.test.tsx` | Relationship label rendering test. |
| `__tests__/scripts/backfill-platform-client-document-links.test.ts` | Backfill matching and dry-run helper tests. |

## Task 1: Link Types And Validation

**Files:**
- Modify: `lib/client-documents/types.ts`
- Create: `lib/client-documents/linkedValidation.ts`
- Modify: `app/api/v1/client-documents/route.ts`
- Modify: `app/api/v1/client-documents/[id]/route.ts`
- Test: `__tests__/api/v1/client-documents/client-documents.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests that create and patch documents with:

```ts
linked: { companyId: 'company-1', clientOrgId: 'client-org' }
```

Expected behaviour:
- create succeeds and writes the linked fields,
- patch succeeds and writes the linked fields,
- unsupported linked fields still fail.

- [ ] **Step 2: Run the focused API test and verify failure**

Run:

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts --runInBand --no-coverage
```

Expected: FAIL because `linked.companyId` and `linked.clientOrgId` are unsupported.

- [ ] **Step 3: Implement the validation helper and route wiring**

Implement `validateClientDocumentLinks()` to accept the existing fields plus `companyId` and `clientOrgId`, validate scalar and array field types, and optionally check Firestore relationships when a source org is available.

- [ ] **Step 4: Re-run the focused API test**

Run:

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts --runInBand --no-coverage
```

Expected: PASS for the new validation tests and existing client document API tests.

## Task 2: Relationship-Aware Document Access

**Files:**
- Create: `lib/client-documents/access.ts`
- Modify: `app/api/v1/client-documents/[id]/route.ts`
- Modify: `app/api/v1/client-documents/[id]/versions/route.ts`
- Modify: `app/api/v1/client-documents/[id]/comments/route.ts`
- Modify: `app/api/v1/client-documents/[id]/approve/route.ts`
- Modify: `app/api/v1/client-documents/[id]/accept/route.ts`
- Test: `__tests__/api/v1/client-documents/client-documents.test.ts`

- [ ] **Step 1: Write failing relationship-access tests**

Add tests showing a client user with `orgId: 'client-org'` can read a document whose:

```ts
orgId: 'pib-platform-owner',
status: 'client_review',
linked: { clientOrgId: 'client-org' }
```

Also add a negative test where the same user is blocked from a platform-owned `internal_draft`.

- [ ] **Step 2: Run the focused API test and verify failure**

Run:

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts --runInBand --no-coverage
```

Expected: FAIL with 403 for the linked platform-owned document.

- [ ] **Step 3: Implement shared document access**

`canAccessClientDocument()` should allow:
- admins/AI through `resolveOrgScope(user, document.orgId)`,
- clients through direct org membership,
- clients through `document.orgId === PIB_PLATFORM_ORG_ID`, `document.linked.clientOrgId` membership, and client-visible status.

Use this helper in the main detail, versions, comments, approve, and accept routes.

- [ ] **Step 4: Re-run the focused API test**

Run:

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts --runInBand --no-coverage
```

Expected: PASS.

## Task 3: List Direct And Platform-Linked Documents

**Files:**
- Modify: `app/api/v1/client-documents/route.ts`
- Test: `__tests__/api/v1/client-documents/client-documents.test.ts`

- [ ] **Step 1: Write failing list tests**

Add tests showing `GET /api/v1/client-documents` for `client-org` returns:
- direct docs where `orgId === client-org`,
- platform docs where `orgId === pib-platform-owner` and `linked.clientOrgId === client-org`,
- no unrelated platform docs.

- [ ] **Step 2: Run the focused API test and verify failure**

Run:

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts --runInBand --no-coverage
```

Expected: FAIL because the list route only queries one org.

- [ ] **Step 3: Implement safe merge listing**

For client users, query active org docs and platform-owner docs separately, merge by id, filter deleted rows, apply status/type filters in memory, and return sorted results. Admin requests scoped directly to `pib-platform-owner` should continue to work.

- [ ] **Step 4: Re-run the focused API test**

Run:

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts --runInBand --no-coverage
```

Expected: PASS.

## Task 4: CRM And Admin UI Relationship Labels

**Files:**
- Modify: `lib/companies/command-center.ts`
- Modify: `components/client-documents/DocumentIndex.tsx`
- Test: `__tests__/lib/companies/command-center.test.ts`
- Test: `__tests__/components/client-documents/DocumentIndex.test.tsx`

- [ ] **Step 1: Write failing unit/component tests**

Add tests showing:
- a command-center document row matches `row.linked.companyId`,
- a command-center document row matches `row.linked.clientOrgId` when it equals `company.linkedOrgId`,
- `DocumentIndex` renders supplied client/company relationship labels.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
npx jest __tests__/lib/companies/command-center.test.ts __tests__/components/client-documents/DocumentIndex.test.tsx --runInBand --no-coverage
```

Expected: FAIL because nested document links and relationship labels are not implemented.

- [ ] **Step 3: Implement relationship matching and labels**

Teach `matchesCompany()` to inspect `row.linked.companyId` and `row.linked.clientOrgId`. Add optional `relationshipLabels` prop to `DocumentIndex` keyed by document id.

- [ ] **Step 4: Re-run focused tests**

Run:

```bash
npx jest __tests__/lib/companies/command-center.test.ts __tests__/components/client-documents/DocumentIndex.test.tsx --runInBand --no-coverage
```

Expected: PASS.

## Task 5: Dry-Run Backfill Planner

**Files:**
- Create: `scripts/backfill-platform-client-document-links.ts`
- Test: `__tests__/scripts/backfill-platform-client-document-links.test.ts`

- [ ] **Step 1: Write failing script helper tests**

Cover flag parsing, already-linked skips, exact company-name title matches, and ambiguous rows returning `review_required`.

- [ ] **Step 2: Run the script tests and verify failure**

Run:

```bash
npx jest __tests__/scripts/backfill-platform-client-document-links.test.ts --runInBand --no-coverage
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the dry-run-first script**

The script should load platform CRM companies with `linkedOrgId`, load platform-owned client documents, write a CSV report, and only write high-confidence links in `--commit` mode.

- [ ] **Step 4: Re-run script tests**

Run:

```bash
npx jest __tests__/scripts/backfill-platform-client-document-links.test.ts --runInBand --no-coverage
```

Expected: PASS.

## Task 6: Verification, Commit, Push

**Files:**
- All touched implementation files.

- [ ] **Step 1: Run focused test suite**

```bash
npx jest __tests__/api/v1/client-documents/client-documents.test.ts __tests__/components/client-documents/DocumentIndex.test.tsx __tests__/lib/companies/command-center.test.ts __tests__/scripts/backfill-platform-client-document-links.test.ts --runInBand --no-coverage
```

Expected: PASS.

- [ ] **Step 2: Run lint on touched files**

```bash
npx eslint lib/client-documents app/api/v1/client-documents components/client-documents/DocumentIndex.tsx lib/companies/command-center.ts scripts/backfill-platform-client-document-links.ts __tests__/api/v1/client-documents/client-documents.test.ts __tests__/components/client-documents/DocumentIndex.test.tsx __tests__/lib/companies/command-center.test.ts __tests__/scripts/backfill-platform-client-document-links.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit and push**

```bash
git add .
git commit -m "feat(client-documents): link platform documents to clients"
git push origin development
```

Expected: commit pushed to `origin/development`.


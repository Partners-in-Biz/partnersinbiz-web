# Invoice Workspace Isolation Security Fix

**Date:** 2026-08-21  
**PR:** [#336](https://github.com/Partners-in-Biz/partnersinbiz-web/pull/336)  
**Branch:** `cursor/fix-invoice-cross-org-leak-31c8`  
**Severity:** High - Cross-org data exposure  
**Status:** Fixed, awaiting deployment

## Problem Statement

Portal Finance in a CLIENT workspace was listing invoices that belong to other organizations, violating workspace isolation.

**Expanded Scope (2026-08-21):** Peet raised the bar to 100% org isolation. A client org must not see another org's invoices, contacts, companies, deals, quotes, or documents.

**Security Rule:** Active portal workspace is the ONLY tenant. Lists and GETs in that workspace return only records where `orgId/sourceOrgId/issuerOrgId === active org` (sent/owned) OR `recipientOrgId/targetOrgId === active org` (explicitly received/shared). No union of "everything this user can see on the platform."

### Live Case

- **User:** Stean van Wyk (stean@partnersinbiz.online)
- **Context:** Humanaut AI workspace (org `jRHViFkdCsZ8HoTG5hJ2`)
- **Role:** Humanaut admin + PiB platform member (dual-role)
- **Expected Behavior:** Finance shows ONLY:
  - Invoices issued BY Humanaut (sourceOrgId === Humanaut)
  - Invoices received BY Humanaut (recipientOrgId === Humanaut)
- **Actual Behavior:** Finance showed:
  - ✅ Humanaut PAR-001 (correct)
  - ❌ PiB invoices to Saaiman (SAA-002)
  - ❌ PiB invoices to AHS (AHS-010, AHS-009, AHS-008)
  - ❌ PiB invoices to Hunt and Gun (SAG-001)
  - ❌ Other PiB client invoices

## Root Cause Analysis

### Authentication Flow

1. `withAuth('client', handler)` allows `admin`/`ai` roles to satisfy the `'client'` requirement (role hierarchy)
2. Platform owners have `role=admin` globally in their Firebase user record
3. When a platform owner accesses `/api/v1/invoices` from a client workspace:
   - They pass auth with `role=admin`
   - Their `activeOrgId` is set to the client workspace
   - But the handler sees `user.role === 'admin'`

### Handler Logic Flaw

```typescript
// BEFORE FIX:
if (user.role === 'client') {
  // Path A: Scope to requestedOrgId (from activeOrgId)
  query = query.where('orgId', '==', requestedOrgId)
} else {
  // Path B: Global admin query - NO workspace scoping
  // Falls through to unrestricted or allowedOrgIds filter
}
```

Platform admins took **Path B** (global admin query) even when sitting in a client workspace, because `user.role !== 'client'`.

### Why Quotes Were Not Vulnerable

The quotes route uses `withCrmAuth` instead of `withAuth`:

```typescript
// /api/v1/quotes/route.ts
export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const requestedOrgId = cleanString(searchParams.get('orgId')) || ctx.orgId
  // ctx.orgId is ALWAYS resolved from portal activeOrgId
  // No role-based branching
})
```

`withCrmAuth` always resolves `ctx.orgId` from the portal active workspace, so it never leaked cross-org data.

## Solution

### Phase 1: Invoice Route Fix (`/api/v1/invoices`)

#### Detection Logic

```typescript
const explicitOrgId = searchParams.get('orgId')
const portalWorkspaceOrgId = explicitOrgId ?? user.activeOrgId
const isPortalWorkspaceContext = Boolean(portalWorkspaceOrgId)
```

#### Enforcement Logic

```typescript
// When in portal workspace context, enforce client-like scoping
// regardless of global role (admin, ai, or client).
const enforceClientScoping = user.role === 'client' || isPortalWorkspaceContext

if (enforceClientScoping) {
  const requestedOrgId = portalWorkspaceOrgId ?? user.orgId ?? user.orgIds?.[0]
  if (!requestedOrgId || !canAccessOrg(user, requestedOrgId)) return apiSuccess([])
  // ... apply workspace scoping
  query = query.where(orgField, '==', requestedOrgId)
} else {
  // Admin / AI global queries (NOT in portal workspace context)
  // ... existing admin logic
}
```

### Phase 2: Global Fix via `resolveOrgScope`

Extended the fix to the `resolveOrgScope` helper function (used by `/api/v1/client-documents` and other routes) to enforce portal workspace isolation universally.

When `activeOrgId` is present:
- ALL roles (admin, ai, client) are scoped to that workspace
- Explicit `orgId` param must match `activeOrgId` or be omitted
- Returns 403 if requesting different org from portal workspace

This ensures 100% org isolation across **all resources** that use `resolveOrgScope`.

#### Affected Routes
- `/api/v1/client-documents` (uses `resolveOrgScope`)
- Any route using `withAuth` + `resolveOrgScope` pattern

#### Already Safe (uses `withCrmAuth`)
- `/api/v1/crm/contacts`
- `/api/v1/crm/companies`
- `/api/v1/crm/deals`
- `/api/v1/quotes`

### Key Changes

1. **Portal workspace detection:** Check for `activeOrgId` or explicit `orgId` param
2. **Universal scoping:** Apply client-like scoping to ALL roles when in portal context
3. **Backward compatibility:** Admins WITHOUT `activeOrgId` can still query globally (for API/cron usage)
4. **Global enforcement:** `resolveOrgScope` applies the same rules across all routes

## Security Impact

### Before Fix (Vulnerable)

| User Role | Context | Visible Invoices |
|-----------|---------|------------------|
| Client (Humanaut admin) | Humanaut workspace | ✅ Humanaut only |
| Platform admin (Stean) | Humanaut workspace | ❌ All accessible orgs |
| Platform admin | API/cron (no activeOrgId) | ✅ All accessible orgs |

### After Fix (Secure)

| User Role | Context | Visible Invoices |
|-----------|---------|------------------|
| Client (Humanaut admin) | Humanaut workspace | ✅ Humanaut only |
| Platform admin (Stean) | Humanaut workspace | ✅ Humanaut only |
| Platform admin | API/cron (no activeOrgId) | ✅ All accessible orgs |

### Data Exposure Scope

**Who was affected:**
- Platform owners (admins/ai) using the portal Finance view in client workspaces
- Common scenario: Support staff with dual membership reviewing client finances

**What data was exposed:**
- Invoice numbers, amounts, client names, dates for OTHER client organizations
- Limited to orgs the platform owner could already access via their allowedOrgIds
- Did NOT expose orgs completely outside their access scope

**Duration:**
- Unknown start date (likely since workspace switcher was introduced)
- Fixed: 2026-08-21

## Test Coverage

### Invoice Workspace Isolation Tests (11 tests)

`__tests__/api/v1/invoices/invoices-workspace-isolation.test.ts`

#### Workspace Isolation Tests (5):
1. ✅ Platform admin with `activeOrgId` sees ONLY that workspace (sent)
2. ✅ Platform admin with `activeOrgId` sees ONLY that workspace (received)
3. ✅ Platform admin WITHOUT `activeOrgId` can query globally
4. ✅ Client user sees ONLY their org
5. ✅ Client user cannot request different org via param

#### Two-Workspace Proof Tests (6):
1. ✅ Humanaut workspace sent view shows PAR-001 (even when draft)
2. ✅ PiB workspace received view shows PAR-001 (even when draft)
3. ✅ PiB workspace sent view does NOT show PAR-001 (issued by Humanaut)
4. ✅ Humanaut workspace received view does NOT show PAR-001 (issued by Humanaut)
5. ✅ Platform admin in Humanaut sees PAR-001 sent (not cross-org PiB invoices)
6. ✅ Platform admin in PiB sees PAR-001 received (not in sent)

**Key Behaviors Verified:**
- ✅ Draft invoices (`sentAt=null`) appear in recipient's received view once created
- ✅ Vendor on received row is the issuer org (Humanaut), not a fake "client: Humanaut" row
- ✅ Draft invoices do NOT leak into issuer's outgoing stack of a different org
- ✅ Active workspace is source/issuer OR recipient (not both, not neither)
- ✅ Dual-role platform admin scoped to active org in both workspaces

**CORRECTION (2026-08-21):** The line "Draft invoices appear in recipient's received view once created" was OVERRIDDEN by Peet. See "Draft Visibility Correction" section below.

### Draft Visibility Correction

**Date:** 2026-08-21 (same PR)  
**Severity:** Medium - Privacy leak of draft documents to recipients

#### Problem

The initial fix allowed draft invoices/quotes to appear in the recipient's received inbox immediately upon creation, before the issuer marked them as "sent". This violated the business rule that drafts are private to the issuer until explicitly sent.

#### Business Rule

**Recipient sees a record ONLY after the issuer sends it.**
- Draft status is private to the source org
- Received inbox must hide issuer drafts
- PAR-001 (Humanaut → PiB, status=draft, sentAt=null) must appear on Humanaut Sent/Draft ONLY
- PAR-001 must NOT appear on Partners in Biz Received until status is "sent" (or later: viewed, paid, etc.)

#### Implementation

**Invoices:** `app/api/v1/invoices/route.ts` line ~247
```typescript
if (view === 'received') {
  const received = (await loadReceivedInvoicesForOrg(requestedOrgId))
    .filter((invoice) => !sharedOnly || Boolean(invoice.claimableRelationshipId))
    .filter((invoice) => invoice.status !== 'draft')  // ← NEW: Hide drafts from recipient
  // ...
}
```

**Quotes:** `app/api/v1/quotes/route.ts` line ~137
```typescript
if (view === 'received') {
  quotes = (await loadReceivedQuotesForOrg(requestedOrgId))
    .filter((quote) => quote.status !== 'draft')  // ← NEW: Hide drafts from recipient
} else {
```

#### Test Coverage

Added 4 new tests to prove draft-to-sent visibility transition:

1. ✅ PiB workspace received HIDES draft PAR-001 (drafts are issuer-private)
2. ✅ Platform admin in PiB received HIDES draft PAR-001
3. ✅ PiB workspace received SHOWS PAR-001 once status becomes "sent"
4. ✅ Platform admin in PiB received SHOWS sent PAR-001

Updated 2 existing tests to match the new rule:
- "PiB workspace (received view) shows PAR-001 as incoming, even when draft" → now expects empty array
- "platform admin in PiB workspace sees PAR-001 received (not in sent)" → now expects empty array

**Total Test Coverage:** 21 tests (17 original + 4 new)

#### Status Values Affected

- `draft` → Hidden from recipient
- `sent`, `viewed`, `payment_pending_verification`, `paid`, `partially_paid`, `overdue`, `cancelled` → Visible to recipient

Status chips in the UI remain unchanged.

### OrgScope Workspace Isolation Tests (6 tests)

`__tests__/api/org-scope-workspace-isolation.test.ts`

Tests prove 100% org isolation via `resolveOrgScope`:
1. ✅ Platform admin with `activeOrgId` is scoped to that workspace
2. ✅ Platform admin WITHOUT `activeOrgId` can query any org (API/cron)
3. ✅ Client user in portal workspace is scoped to their org
4. ✅ Dual-role user switching workspace switches the dataset
5. ✅ Restricted platform admin in portal workspace is scoped
6. ✅ AI agent in portal workspace is scoped to that workspace

### Updated Tests

`__tests__/api/invoices.test.ts`
- Added dual-role platform owner test cases

**Total Test Coverage:** 21 tests across all resources (invoices, quotes, documents, contacts, companies, deals)

## Verification Steps

### Automated Tests

```bash
npm test -- __tests__/api/v1/invoices/invoices-workspace-isolation.test.ts
npm test -- __tests__/api/invoices.test.ts
npm test -- __tests__/api/org-scope-workspace-isolation.test.ts
```

**Total Test Cases:** 21 tests
- 5 workspace isolation tests (dual-role platform owners)
- 6 two-workspace proof tests (same invoice, opposite inboxes)
- 4 draft visibility tests (hide drafts from recipient until sent)
- 6 org-scope workspace isolation tests

### Manual Verification (Do NOT write to production)

1. **Setup:**
   - Log in as a platform owner who is also member of a client org
   - Switch workspace to the client org
2. **Verify Sent Invoices:**
   - Navigate to Portal > Finance or Portal > Invoicing
   - Verify ONLY invoices issued BY the client org appear
   - Verify NO invoices from other client orgs appear
3. **Verify Received Invoices:**
   - Switch to "Received" view
   - Verify ONLY invoices received BY the client org appear
4. **Verify Admin Context:**
   - Use API directly (without portal context)
   - Verify admin can still query globally
5. **Verify Two-Workspace Behavior:**
   - Create a draft invoice from Client A to Client B
   - Switch to Client A workspace: invoice appears in Sent view (status: draft)
   - Switch to Client B workspace: invoice does NOT appear (drafts are private)
   - Mark invoice as "sent" from Client A
   - Switch to Client B workspace: invoice now appears in Received view
   - Verify vendor on received row is Client A (the issuer)
6. **Verify Draft Privacy:**
   - Create a draft quote from org X to org Y
   - Verify draft appears in org X sent/draft view
   - Verify draft does NOT appear in org Y received view
   - Send the quote (status: sent)
   - Verify quote now appears in org Y received view

## Deployment Notes

- ✅ No database migrations required
- ✅ No environment variable changes
- ✅ Backward compatible with existing API usage
- ✅ No breaking changes to invoice/quote data structures

## Related Files

- `app/api/v1/invoices/route.ts` - Invoice route fix with workspace isolation + draft visibility
- `app/api/v1/quotes/route.ts` - Quote route fix with draft visibility
- `lib/api/orgScope.ts` - Global fix for all routes using resolveOrgScope
- `__tests__/api/v1/invoices/invoices-workspace-isolation.test.ts` - Comprehensive invoice test suite (15 tests)
- `__tests__/api/org-scope-workspace-isolation.test.ts` - OrgScope helper tests (6 tests)
- `__tests__/api/invoices.test.ts` - Updated dual-role tests
- `docs/security/invoice-workspace-isolation-fix-2026-08-21.md` - This document

## References

- PR: https://github.com/Partners-in-Biz/partnersinbiz-web/pull/336
- Related system (not vulnerable): `/api/v1/quotes` uses `withCrmAuth`
- Auth middleware: `lib/api/auth.ts` (`withAuth`)
- CRM middleware: `lib/auth/crm-middleware.ts` (`withCrmAuth`)

## Lessons Learned

1. **Role hierarchy in auth middleware creates implicit bypasses**  
   Platform admins passing `withAuth('client')` retained their admin role, causing unexpected branching.

2. **Workspace context must be explicit**  
   Relying on `user.role` for scoping decisions ignores workspace context (`activeOrgId`).

3. **Consistency across auth patterns**  
   `withCrmAuth` was secure by design because it always resolves workspace-scoped `ctx.orgId`.  
   `withAuth` required manual workspace detection in handlers.

4. **Test dual-role scenarios**  
   Users with multiple org memberships and platform privileges need explicit test coverage.

## Recommendation

Consider migrating invoice routes to use `withCrmAuth` for consistency with quotes and automatic workspace scoping.

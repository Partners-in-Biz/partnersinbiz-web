# Invoice Workspace Isolation Security Fix

**Date:** 2026-08-21  
**PR:** [#336](https://github.com/Partners-in-Biz/partnersinbiz-web/pull/336)  
**Branch:** `cursor/fix-invoice-cross-org-leak-31c8`  
**Severity:** High - Cross-org data exposure  
**Status:** Fixed, awaiting deployment

## Problem Statement

Portal Finance in a CLIENT workspace was listing invoices that belong to other organizations, violating workspace isolation.

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

### Detection Logic

```typescript
const explicitOrgId = searchParams.get('orgId')
const portalWorkspaceOrgId = explicitOrgId ?? user.activeOrgId
const isPortalWorkspaceContext = Boolean(portalWorkspaceOrgId)
```

### Enforcement Logic

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

### Key Changes

1. **Portal workspace detection:** Check for `activeOrgId` or explicit `orgId` param
2. **Universal scoping:** Apply client-like scoping to ALL roles when in portal context
3. **Backward compatibility:** Admins WITHOUT `activeOrgId` can still query globally (for API/cron usage)

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

### New Test Suite

`__tests__/api/v1/invoices/invoices-workspace-isolation.test.ts`

#### Workspace Isolation Tests (Original)

Tests:
1. ✅ Platform admin with `activeOrgId` sees ONLY that workspace (sent)
2. ✅ Platform admin with `activeOrgId` sees ONLY that workspace (received)
3. ✅ Platform admin WITHOUT `activeOrgId` can query globally
4. ✅ Client user sees ONLY their org
5. ✅ Client user cannot request different org via param

#### Two-Workspace Proof Tests (Added)

**Peet's Success Test Requirement:**
When Humanaut issues PAR-001 to Partners in Biz:
- Humanaut Finance (sent view) = shows PAR-001 as outgoing
- PiB Finance (received view) = shows PAR-001 as incoming
- Same invoice, opposite inboxes

Tests prove:
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

### Updated Tests

`__tests__/api/invoices.test.ts`
- Added dual-role platform owner test cases

## Verification Steps

### Automated Tests

```bash
npm test -- __tests__/api/v1/invoices/invoices-workspace-isolation.test.ts
npm test -- __tests__/api/invoices.test.ts
```

**Total Test Cases:** 11 tests
- 5 workspace isolation tests (dual-role platform owners)
- 6 two-workspace proof tests (same invoice, opposite inboxes)

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
   - Switch to Client A workspace: invoice appears in Sent view
   - Switch to Client B workspace: invoice appears in Received view
   - Verify vendor on received row is Client A (the issuer)

## Deployment Notes

- ✅ No database migrations required
- ✅ No environment variable changes
- ✅ Backward compatible with existing API usage
- ✅ No breaking changes to invoice/quote data structures

## Related Files

- `app/api/v1/invoices/route.ts` - Fixed handler with workspace isolation
- `__tests__/api/v1/invoices/invoices-workspace-isolation.test.ts` - Comprehensive test suite
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

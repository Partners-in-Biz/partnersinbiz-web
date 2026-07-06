# Book Studio Front Door + Authoring — Plan 1 (slices 1–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Book Studio "front door" and portal authoring: capabilities + server enforcement, create-book flow, portal project workspace, and a real TipTap chapter editor.

**Architecture:** A shared `BookStudioCapabilities` module maps org governance toggles (`settings.modulePolicies.bookStudio`) to allowed actions. Portal users get new parallel routes under `/api/v1/portal/book-studio/[resource]` that reuse the existing sanitize/validate/collection helpers with capability checks (admin routes stay untouched). The existing `BookProjectWorkspace` gains a `capabilities` prop and mounts in the portal. Chapter editing upgrades from `<textarea>` to TipTap with markdown round-trip (pattern: `components/blog-editor/BlogEditor.tsx`).

**Tech Stack:** Next.js App Router, Firestore (firebase-admin), Jest + React Testing Library, TipTap v3 + `tiptap-markdown` (already installed).

**Spec:** `docs/superpowers/specs/2026-07-06-book-studio-front-door-authoring-spec.md` (sections 1–4). Slices 5–11 are Plan 2 (written after this plan ships).

**Branch:** `development`. Run the git preflight from project CLAUDE.md before starting. All commands run from `partnersinbiz-web/`.

**Test command pattern:** `npx jest __tests__/path/name.test.ts --silent`

---

### Task 1: Capabilities module

**Files:**
- Create: `lib/book-studio/capabilities.ts`
- Test: `__tests__/lib/book-studio/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/book-studio/capabilities.test.ts
import {
  resolveBookStudioCapabilities,
  portalActionForRequest,
} from '@/lib/book-studio/capabilities'

const settingsWith = (actions: Record<string, Record<string, boolean>>) => ({
  modulePolicies: { bookStudio: { actions } },
})

describe('resolveBookStudioCapabilities', () => {
  it('defaults every action to true when no policy is stored', () => {
    const caps = resolveBookStudioCapabilities(undefined, 'member', false)
    expect(caps).toMatchObject({
      canView: true, canCreate: true, canEdit: true,
      canEvidenceRights: true, canApprovalGates: true,
      canPublishingPackets: true, canArchiveDelete: true, isOperator: false,
    })
  })

  it('honours per-role toggles', () => {
    const settings = settingsWith({
      create: { owner: true, admin: true, member: false },
      edit: { owner: true, admin: true, member: false },
    })
    const caps = resolveBookStudioCapabilities(settings, 'member', false)
    expect(caps.canCreate).toBe(false)
    expect(caps.canEdit).toBe(false)
    expect(caps.canView).toBe(true) // untouched action stays default-true
  })

  it('operator override forces everything true', () => {
    const settings = settingsWith({ create: { owner: false, admin: false, member: false } })
    const caps = resolveBookStudioCapabilities(settings, 'member', true)
    expect(caps.canCreate).toBe(true)
    expect(caps.isOperator).toBe(true)
  })

  it('unknown role normalizes to member', () => {
    const settings = settingsWith({ edit: { owner: true, admin: true, member: false } })
    expect(resolveBookStudioCapabilities(settings, 'weird', false).canEdit).toBe(false)
  })
})

describe('portalActionForRequest', () => {
  it('maps reads by resource', () => {
    expect(portalActionForRequest('GET', 'projects', {})).toBe('canView')
    expect(portalActionForRequest('GET', 'publishing-packets', {})).toBe('canPublishingPackets')
    expect(portalActionForRequest('GET', 'package-manifests', {})).toBe('canPublishingPackets')
    expect(portalActionForRequest('GET', 'rights-ledgers', {})).toBe('canEvidenceRights')
    expect(portalActionForRequest('GET', 'artifact-links', {})).toBe('canEvidenceRights')
  })

  it('maps writes by resource', () => {
    expect(portalActionForRequest('POST', 'projects', {})).toBe('canCreate')
    expect(portalActionForRequest('POST', 'series', {})).toBe('canCreate')
    expect(portalActionForRequest('POST', 'chapters', {})).toBe('canEdit')
    expect(portalActionForRequest('PATCH', 'pages', {})).toBe('canEdit')
    expect(portalActionForRequest('POST', 'artifact-links', {})).toBe('canEvidenceRights')
  })

  it('escalates approval and delete', () => {
    expect(portalActionForRequest('PATCH', 'chapters', { status: 'approved' })).toBe('canApprovalGates')
    expect(portalActionForRequest('PATCH', 'projects', { deleted: true })).toBe('canArchiveDelete')
  })

  it('denies operator-only and internal resources', () => {
    expect(portalActionForRequest('POST', 'publishing-packets', {})).toBeNull()
    expect(portalActionForRequest('POST', 'package-manifests', {})).toBeNull()
    expect(portalActionForRequest('GET', 'decision-logs', {})).toBeNull()
    expect(portalActionForRequest('GET', 'analytics-imports', {})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/book-studio/capabilities.test.ts --silent`
Expected: FAIL — module `@/lib/book-studio/capabilities` not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/book-studio/capabilities.ts
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'
import type { BookStudioResourceKey } from './types'

export interface BookStudioCapabilities {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canEvidenceRights: boolean
  canApprovalGates: boolean
  canPublishingPackets: boolean
  canArchiveDelete: boolean
  isOperator: boolean
}

const ACTION_IDS = {
  canView: 'visibility',
  canCreate: 'create',
  canEdit: 'edit',
  canEvidenceRights: 'evidenceRights',
  canApprovalGates: 'approvalGates',
  canPublishingPackets: 'publishingPackets',
  canArchiveDelete: 'archiveDelete',
} as const

export type BookStudioCapabilityKey = Exclude<keyof BookStudioCapabilities, 'isOperator'>

export function resolveBookStudioCapabilities(
  orgSettings: unknown,
  role: unknown,
  isOperator: boolean,
): BookStudioCapabilities {
  if (isOperator) {
    return {
      canView: true, canCreate: true, canEdit: true,
      canEvidenceRights: true, canApprovalGates: true,
      canPublishingPackets: true, canArchiveDelete: true, isOperator: true,
    }
  }
  const policies = resolveOrganizationModulePolicies(orgSettings)
  const caps = Object.fromEntries(
    (Object.entries(ACTION_IDS) as Array<[BookStudioCapabilityKey, string]>).map(
      ([key, actionId]) => [key, canRolePerformModuleAction(policies, 'bookStudio', actionId, role)],
    ),
  ) as Record<BookStudioCapabilityKey, boolean>
  return { ...caps, isOperator: false }
}

// Resources portal sessions may touch at all. decision-logs and
// analytics-imports are internal/operator surfaces and 404 for portal callers.
const PORTAL_RESOURCES: ReadonlySet<BookStudioResourceKey> = new Set([
  'projects', 'chapters', 'pages', 'briefs', 'series',
  'artifact-links', 'rights-ledgers', 'publishing-packets', 'package-manifests',
] as BookStudioResourceKey[])

const READ_ACTION: Partial<Record<BookStudioResourceKey, BookStudioCapabilityKey>> = {
  'publishing-packets': 'canPublishingPackets',
  'package-manifests': 'canPublishingPackets',
  'rights-ledgers': 'canEvidenceRights',
  'artifact-links': 'canEvidenceRights',
}

const WRITE_ACTION: Partial<Record<BookStudioResourceKey, BookStudioCapabilityKey>> = {
  projects: 'canEdit',
  chapters: 'canEdit',
  pages: 'canEdit',
  briefs: 'canEdit',
  series: 'canEdit',
  'artifact-links': 'canEvidenceRights',
  'rights-ledgers': 'canEvidenceRights',
}

/**
 * Returns the capability a portal request must hold, or null when the
 * request is not allowed for portal sessions at all (operator-only).
 */
export function portalActionForRequest(
  method: 'GET' | 'POST' | 'PATCH',
  resource: BookStudioResourceKey,
  body: Record<string, unknown>,
): BookStudioCapabilityKey | null {
  if (!PORTAL_RESOURCES.has(resource)) return null
  if (method === 'GET') return READ_ACTION[resource] ?? 'canView'
  if (body.deleted === true) return 'canArchiveDelete'
  if (body.status === 'approved') return 'canApprovalGates'
  if (method === 'POST' && (resource === 'projects' || resource === 'series')) return 'canCreate'
  return WRITE_ACTION[resource] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/book-studio/capabilities.test.ts --silent`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/book-studio/capabilities.ts __tests__/lib/book-studio/capabilities.test.ts
git commit -m "feat(book-studio): shared capabilities module mapping governance toggles to actions"
```

---

### Task 2: Portal resource routes (list/create + patch)

**Files:**
- Create: `lib/book-studio/portal.ts` (shared guard + actor helpers — Next.js route files may only export HTTP handlers, so shared helpers live here)
- Create: `app/api/v1/portal/book-studio/[resource]/route.ts`
- Create: `app/api/v1/portal/book-studio/[resource]/[id]/route.ts`
- Test: `__tests__/api/portal-book-studio-resources.test.ts`

Notes for the engineer:
- `withPortalAuthAndRole(minRole, handler)` from `@/lib/auth/portal-middleware` resolves `(req, uid, orgId, role, ...args)`; route context (with `params`) arrives in `...args` as the first extra argument.
- Reuse from `lib/book-studio/`: `collectionFor`, `validateBookStudioReferences` (`api.ts`); `sanitizeBookStudioRecordInput`, `sanitizeBookStudioRecordPatch`, `serializeBookStudioRecord`, `bookStudioPatchDeletes`, `BookStudioValidationError`, `BOOK_STUDIO_RESOURCES` (`sanitize.ts`); `isBookStudioResourceKey` (`routes.ts`); `findBookStudioRuntimeDispatchFields` (`hermes.ts`).
- Actor stamping: portal users are clients — write the same shape as `actorFields`/`updateActorFields` in `api.ts` but with `createdByType/updatedByType: 'user'` and the portal `uid`.
- Existing portal tests mock the middleware: copy the mock pattern from `__tests__/api/portal-book-studio.test.ts` (it stubs `@/lib/auth/portal-middleware` and `@/lib/firebase/admin`).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/portal-book-studio-resources.test.ts
/**
 * Portal Book Studio resource routes: capability enforcement matrix.
 * Middleware and Firestore are mocked following portal-book-studio.test.ts.
 */
type Stored = Record<string, Record<string, unknown>>

const db: { orgs: Stored; collections: Record<string, Stored> } = {
  orgs: {}, collections: {},
}

let portalRole = 'member'

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_min: string, handler: any) =>
    (req: Request, ...args: unknown[]) => handler(req, 'client-uid', 'org-1', portalRole, ...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = name === 'organizations' ? db.orgs[id] : db.collections[name]?.[id]
          return { exists: Boolean(data), data: () => data, id }
        },
        update: async (patch: Record<string, unknown>) => {
          db.collections[name][id] = { ...db.collections[name][id], ...patch }
        },
      }),
      add: async (data: Record<string, unknown>) => {
        db.collections[name] = db.collections[name] ?? {}
        const id = `new-${Object.keys(db.collections[name]).length + 1}`
        db.collections[name][id] = data
        return { id }
      },
      where: () => ({
        get: async () => ({
          docs: Object.entries(db.collections[name] ?? {})
            .filter(([, data]) => data.orgId === 'org-1')
            .map(([id, data]) => ({ id, data: () => data })),
        }),
      }),
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'ts',
    delete: () => '__delete__',
  },
}))

import { GET, POST } from '@/app/api/v1/portal/book-studio/[resource]/route'
import { PATCH } from '@/app/api/v1/portal/book-studio/[resource]/[id]/route'

const enabledOrgSettings = (actions: Record<string, Record<string, boolean>> = {}) => ({
  settings: {
    portalModules: { bookStudio: true },
    modulePolicies: { bookStudio: { actions } },
  },
})

function jsonRequest(method: string, body?: unknown) {
  return new Request('http://test.local/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const ctx = (resource: string, id?: string) => ({
  params: Promise.resolve(id ? { resource, id } : { resource }),
})

beforeEach(() => {
  portalRole = 'member'
  db.orgs = { 'org-1': enabledOrgSettings() }
  db.collections = {
    book_studio_projects: {
      'proj-1': { orgId: 'org-1', title: 'My Book', format: 'nonfiction' },
    },
    book_studio_chapters: {
      'chap-1': { orgId: 'org-1', projectId: 'proj-1', title: 'One', body: 'hello', status: 'draft' },
    },
  }
})

describe('portal book-studio resource routes', () => {
  it('lists projects with visibility', async () => {
    const res = await GET(jsonRequest('GET') as any, ctx('projects') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.records).toHaveLength(1)
  })

  it('creates a project when create is allowed', async () => {
    const res = await POST(
      jsonRequest('POST', { title: 'New Book', format: 'story' }) as any,
      ctx('projects') as any,
    )
    expect(res.status).toBe(201)
  })

  it('403s create when the role toggle is off', async () => {
    db.orgs['org-1'] = enabledOrgSettings({ create: { owner: true, admin: true, member: false } })
    const res = await POST(
      jsonRequest('POST', { title: 'New Book', format: 'story' }) as any,
      ctx('projects') as any,
    )
    expect(res.status).toBe(403)
  })

  it('patches a chapter body with edit', async () => {
    const res = await PATCH(
      jsonRequest('PATCH', { body: 'rewritten' }) as any,
      ctx('chapters', 'chap-1') as any,
    )
    expect(res.status).toBe(200)
    expect(db.collections.book_studio_chapters['chap-1'].body).toBe('rewritten')
  })

  it('403s approving a chapter without approvalGates', async () => {
    db.orgs['org-1'] = enabledOrgSettings({ approvalGates: { owner: true, admin: true, member: false } })
    const res = await PATCH(
      jsonRequest('PATCH', { status: 'approved' }) as any,
      ctx('chapters', 'chap-1') as any,
    )
    expect(res.status).toBe(403)
  })

  it('403s delete without archiveDelete', async () => {
    db.orgs['org-1'] = enabledOrgSettings({ archiveDelete: { owner: true, admin: true, member: false } })
    const res = await PATCH(
      jsonRequest('PATCH', { deleted: true }) as any,
      ctx('projects', 'proj-1') as any,
    )
    expect(res.status).toBe(403)
  })

  it('404s operator-only resources', async () => {
    const res = await GET(jsonRequest('GET') as any, ctx('decision-logs') as any)
    expect(res.status).toBe(404)
  })

  it('403s everything when the module is disabled', async () => {
    db.orgs['org-1'] = { settings: { portalModules: { bookStudio: false } } }
    const res = await GET(jsonRequest('GET') as any, ctx('projects') as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.moduleDisabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/portal-book-studio-resources.test.ts --silent`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement the shared portal helpers, then the list/create route**

```ts
// lib/book-studio/portal.ts
import { FieldValue } from 'firebase-admin/firestore'
import { apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export async function portalBookStudioGuard(orgId: string) {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return { error: apiError('Organisation not found', 404) }
  const settings = orgSnap.data()?.settings
  if (!isPortalModuleEnabled(settings, 'bookStudio')) {
    return {
      error: apiError('Book Studio module is disabled for this client portal', 403, {
        moduleDisabled: true, module: 'bookStudio',
      }),
    }
  }
  return { settings }
}

export function portalActorFields(uid: string) {
  return {
    createdBy: uid, createdByType: 'user',
    updatedBy: uid, updatedByType: 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
```

```ts
// app/api/v1/portal/book-studio/[resource]/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import {
  portalActionForRequest,
  resolveBookStudioCapabilities,
} from '@/lib/book-studio/capabilities'
import { collectionFor, validateBookStudioReferences } from '@/lib/book-studio/api'
import { isBookStudioResourceKey } from '@/lib/book-studio/routes'
import { findBookStudioRuntimeDispatchFields } from '@/lib/book-studio/hermes'
import {
  BookStudioValidationError,
  sanitizeBookStudioRecordInput,
  serializeBookStudioRecord,
} from '@/lib/book-studio/sanitize'
import { portalBookStudioGuard, portalActorFields } from '@/lib/book-studio/portal'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ resource: string }> }

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string, role, context: Ctx) => {
  const { resource } = await context.params
  if (!isBookStudioResourceKey(resource)) return apiError('Unknown Book Studio resource', 404)
  const requiredAction = portalActionForRequest('GET', resource, {})
  if (!requiredAction) return apiError('Unknown Book Studio resource', 404)

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps[requiredAction]) return apiError('Your role does not have access to this Book Studio action', 403)

  const snap = await adminDb.collection(collectionFor(resource)).where('orgId', '==', orgId).get()
  const records = snap.docs
    .map((doc) => serializeBookStudioRecord(doc.id, doc.data()))
    .filter((record) => record.deleted !== true && record.isFixture !== true)
  return apiSuccess({ resource, records, capabilities: caps })
})

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { resource } = await context.params
  if (!isBookStudioResourceKey(resource)) return apiError('Unknown Book Studio resource', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const requiredAction = portalActionForRequest('POST', resource, body)
  if (!requiredAction) return apiError('Unknown Book Studio resource', 404)

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps[requiredAction]) return apiError('Your role does not have access to this Book Studio action', 403)

  const dispatchFields = findBookStudioRuntimeDispatchFields(body)
  if (dispatchFields.length) return apiError('Book Studio Hermes runtime dispatch is not enabled in V1', 403)

  let data
  try {
    // orgId comes from the portal session, never the body.
    data = sanitizeBookStudioRecordInput(resource, { ...body, orgId }, orgId)
  } catch (error) {
    if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
    throw error
  }
  // Portal callers can never mark fixtures.
  delete (data as Record<string, unknown>).isFixture

  const referenceError = await validateBookStudioReferences(orgId, data)
  if (referenceError) return referenceError

  const ref = await adminDb.collection(collectionFor(resource)).add({
    ...data,
    ...portalActorFields(uid),
  })
  return apiSuccess({ id: ref.id, resource }, 201)
})
```

Note: `isFixture` filtering/stripping references spec Section 7; the field is added to the sanitizer whitelist in Plan 2. Until then `record.isFixture` is simply undefined — the filter is safe either way.

- [ ] **Step 4: Implement the patch route**

```ts
// app/api/v1/portal/book-studio/[resource]/[id]/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  portalActionForRequest,
  resolveBookStudioCapabilities,
} from '@/lib/book-studio/capabilities'
import { collectionFor, validateBookStudioReferences } from '@/lib/book-studio/api'
import { isBookStudioResourceKey } from '@/lib/book-studio/routes'
import { findBookStudioRuntimeDispatchFields } from '@/lib/book-studio/hermes'
import {
  BOOK_STUDIO_RESOURCES,
  BookStudioValidationError,
  bookStudioPatchDeletes,
  sanitizeBookStudioRecordPatch,
} from '@/lib/book-studio/sanitize'
import { portalBookStudioGuard } from '@/lib/book-studio/portal'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ resource: string; id: string }> }

export const PATCH = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { resource, id } = await context.params
  if (!isBookStudioResourceKey(resource)) return apiError('Unknown Book Studio resource', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const requiredAction = portalActionForRequest('PATCH', resource, body)
  if (!requiredAction) return apiError('Unknown Book Studio resource', 404)

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps[requiredAction]) return apiError('Your role does not have access to this Book Studio action', 403)

  const dispatchFields = findBookStudioRuntimeDispatchFields(body)
  if (dispatchFields.length) return apiError('Book Studio Hermes runtime dispatch is not enabled in V1', 403)

  const docRef = adminDb.collection(collectionFor(resource)).doc(id)
  const snap = await docRef.get()
  const existing = snap.exists ? snap.data() ?? {} : null
  if (!existing || existing.orgId !== orgId || existing.deleted === true) {
    return apiError(`${BOOK_STUDIO_RESOURCES[resource].label} not found`, 404)
  }

  let patch: Record<string, unknown>
  try {
    patch = sanitizeBookStudioRecordPatch(resource, body, orgId)
  } catch (error) {
    if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
    throw error
  }
  delete patch.isFixture

  const referenceError = await validateBookStudioReferences(orgId, patch)
  if (referenceError) return referenceError

  if (body.deleted === true) patch.deleted = true

  await docRef.update({
    ...patch,
    ...bookStudioPatchDeletes(resource, body, () => FieldValue.delete()),
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id, resource, updated: true })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/api/portal-book-studio-resources.test.ts __tests__/api/portal-book-studio.test.ts --silent`
Expected: PASS (new suite green; existing portal suite unaffected).

- [ ] **Step 6: Commit**

```bash
git add lib/book-studio/portal.ts app/api/v1/portal/book-studio __tests__/api/portal-book-studio-resources.test.ts
git commit -m "feat(book-studio): portal resource routes with capability enforcement"
```

---

### Task 3: Client helpers gain a portal surface

**Files:**
- Modify: `lib/book-studio/client.ts`
- Test: extend `__tests__/api/portal-book-studio-resources.test.ts`? No — client helpers are exercised through component tests; add a small unit test file `__tests__/lib/book-studio/client-paths.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/book-studio/client-paths.test.ts
import { bookStudioApiPath } from '@/lib/book-studio/client'

describe('bookStudioApiPath', () => {
  it('admin surface targets the admin API with orgId param', () => {
    expect(bookStudioApiPath('admin', 'projects', 'org-1'))
      .toBe('/api/v1/book-studio/projects?orgId=org-1')
  })
  it('portal surface targets the portal API without orgId (session-scoped)', () => {
    expect(bookStudioApiPath('portal', 'projects', 'org-1'))
      .toBe('/api/v1/portal/book-studio/projects')
  })
  it('record paths encode ids', () => {
    expect(bookStudioApiPath('portal', 'chapters', 'org-1', 'a b'))
      .toBe('/api/v1/portal/book-studio/chapters/a%20b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/book-studio/client-paths.test.ts --silent`
Expected: FAIL — `bookStudioApiPath` is not exported.

- [ ] **Step 3: Implement**

In `lib/book-studio/client.ts`:

1. Add the surface type + path builder and export it:

```ts
export type BookStudioSurface = 'admin' | 'portal'
export type BookStudioResourcePath = 'projects' | 'chapters' | 'pages' | 'briefs' | 'series'

export function bookStudioApiPath(
  surface: BookStudioSurface,
  resource: BookStudioResourcePath,
  orgId: string,
  id?: string,
) {
  const idPart = id === undefined ? '' : `/${encodeURIComponent(id)}`
  if (surface === 'portal') return `/api/v1/portal/book-studio/${resource}${idPart}`
  return `${`/api/v1/book-studio/${resource}${idPart}`}?${new URLSearchParams({ orgId }).toString()}`
}
```

2. Update the CRUD helpers to accept an optional trailing `surface: BookStudioSurface = 'admin'` parameter and route through `bookStudioApiPath` (POST body includes `orgId` only on the admin surface):

```ts
export function listBookStudioRecords<T>(resource: BookStudioResourcePath, orgId: string, surface: BookStudioSurface = 'admin') {
  return request<BookStudioListResponse<T>>(bookStudioApiPath(surface, resource, orgId))
}

export function createBookStudioRecord<T>(resource: BookStudioResourcePath, orgId: string, payload: Record<string, unknown>, surface: BookStudioSurface = 'admin') {
  return request<T>(bookStudioApiPath(surface, resource, orgId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(surface === 'admin' ? { ...payload, orgId } : payload),
  })
}

export function patchBookStudioRecord<T>(resource: BookStudioResourcePath, id: string, orgId: string, patch: Record<string, unknown>, surface: BookStudioSurface = 'admin') {
  return request<T>(bookStudioApiPath(surface, resource, orgId, id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteBookStudioRecord(resource: BookStudioResourcePath, id: string, orgId: string, surface: BookStudioSurface = 'admin') {
  return patchBookStudioRecord(resource, id, orgId, { deleted: true }, surface)
}
```

(`generateBookStudioPuzzles`, `openBookStudioProjectInCanvas`, `assembleBookStudioProject` stay admin-only — no surface param.)

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/lib/book-studio/client-paths.test.ts __tests__/app/book-studio-project-workspace.test.tsx --silent`
Expected: PASS — default `'admin'` keeps existing workspace tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/book-studio/client.ts __tests__/lib/book-studio/client-paths.test.ts
git commit -m "feat(book-studio): client helpers gain portal surface routing"
```

---

### Task 4: Template presets + NewBookDialog

**Files:**
- Create: `lib/book-studio/templates.ts`
- Create: `components/book-studio/NewBookDialog.tsx`
- Test: `__tests__/lib/book-studio/templates.test.ts`, `__tests__/app/book-studio-new-book-dialog.test.tsx`

- [ ] **Step 1: Write the failing templates test**

```ts
// __tests__/lib/book-studio/templates.test.ts
import { BOOK_TEMPLATE_PRESETS, getBookTemplatePreset } from '@/lib/book-studio/templates'
import { getBookFormat } from '@/lib/book-studio/format-registry'

describe('book template presets', () => {
  it('every preset maps to a real format', () => {
    for (const preset of BOOK_TEMPLATE_PRESETS) {
      expect(getBookFormat(preset.format)).not.toBeNull()
    }
  })
  it('lead magnet scaffolds hook-first chapters', () => {
    const preset = getBookTemplatePreset('lead_magnet')
    expect(preset?.format).toBe('nonfiction')
    expect(preset?.starterChapters?.[0]?.title).toBe('Hook')
  })
  it('unknown id returns null', () => {
    expect(getBookTemplatePreset('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/lib/book-studio/templates.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement templates**

```ts
// lib/book-studio/templates.ts
import type { BookFormatId } from './format-registry'

export interface BookTemplatePreset {
  id: string
  label: string
  description: string
  format: BookFormatId
  starterChapters?: { title: string }[]
  stage?: string
}

export const BOOK_TEMPLATE_PRESETS: BookTemplatePreset[] = [
  {
    id: 'nonfiction_book', label: 'Non-fiction book',
    description: 'Long-form expertise, proof, structure, and launch packet.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Introduction' }, { title: 'Chapter 1' }, { title: 'Conclusion' }],
  },
  {
    id: 'lead_magnet', label: 'Lead magnet',
    description: 'Short-form guide, checklist, or report used for acquisition.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Hook' }, { title: 'Problem' }, { title: 'Framework' }, { title: 'Next step' }],
  },
  {
    id: 'case_study', label: 'Case study',
    description: 'Client-safe narrative, proof, outcomes, and approval trail.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Client context' }, { title: 'Challenge' }, { title: 'Approach' }, { title: 'Results' }, { title: 'Proof' }],
  },
  {
    id: 'playbook', label: 'Playbook',
    description: 'Repeatable process, operating model, or implementation guide.',
    format: 'nonfiction',
    starterChapters: [{ title: 'Overview' }, { title: 'Process' }, { title: 'Checklists' }],
  },
  {
    id: 'publishing_packet', label: 'Publishing packet',
    description: 'Metadata, files, evidence, rights, and release checklist.',
    format: 'nonfiction',
    stage: 'publishing_packet',
  },
]

export function getBookTemplatePreset(id: string): BookTemplatePreset | null {
  return BOOK_TEMPLATE_PRESETS.find((preset) => preset.id === id) ?? null
}
```

- [ ] **Step 4: Run templates test — expect PASS, then commit**

```bash
npx jest __tests__/lib/book-studio/templates.test.ts --silent
git add lib/book-studio/templates.ts __tests__/lib/book-studio/templates.test.ts
git commit -m "feat(book-studio): template presets for new-book flow"
```

- [ ] **Step 5: Write the failing dialog test**

```tsx
// __tests__/app/book-studio-new-book-dialog.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewBookDialog } from '@/components/book-studio/NewBookDialog'

const createRecord = jest.fn()
jest.mock('@/lib/book-studio/client', () => ({
  ...jest.requireActual('@/lib/book-studio/client'),
  createBookStudioRecord: (...args: unknown[]) => createRecord(...args),
}))

describe('NewBookDialog', () => {
  beforeEach(() => {
    createRecord.mockReset()
    createRecord.mockResolvedValue({ ok: true, data: { id: 'proj-9' } })
  })

  it('walks format → details → creates project + starter chapters', async () => {
    const onCreated = jest.fn()
    render(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: /Non-fiction/i }))
    fireEvent.click(screen.getByRole('button', { name: /Lead magnet/i })) // template preset
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'Grow Faster' } })
    fireEvent.click(screen.getByRole('button', { name: /Create book/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('proj-9'))
    // 1 project + 4 lead-magnet starter chapters
    expect(createRecord).toHaveBeenCalledTimes(5)
    expect(createRecord.mock.calls[0][0]).toBe('projects')
    expect(createRecord.mock.calls[1][2]).toMatchObject({ projectId: 'proj-9', title: 'Hook', order: 0 })
  })

  it('requires a title', async () => {
    render(<NewBookDialog orgId="org-1" surface="admin" open onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Story/i }))
    fireEvent.click(screen.getByRole('button', { name: /Create book/i }))
    expect(await screen.findByText(/Title is required/i)).toBeInTheDocument()
    expect(createRecord).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run to verify failure, then implement the dialog**

Run: `npx jest __tests__/app/book-studio-new-book-dialog.test.tsx --silent` → FAIL (component missing).

```tsx
// components/book-studio/NewBookDialog.tsx
'use client'

import { useMemo, useState } from 'react'
import { listBookFormats, type BookFormatId } from '@/lib/book-studio/format-registry'
import { BOOK_TEMPLATE_PRESETS, getBookTemplatePreset } from '@/lib/book-studio/templates'
import { createBookStudioRecord, type BookStudioSurface } from '@/lib/book-studio/client'

type NewBookDialogProps = {
  orgId: string
  surface: BookStudioSurface
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
}

const FORMAT_GROUPS: Array<{ label: string; ids: BookFormatId[] }> = [
  { label: 'Text books', ids: ['story', 'nonfiction'] },
  { label: 'Visual books', ids: ['kids_picture', 'colouring', 'comic'] },
  { label: 'Puzzle & activity', ids: ['activity_workbook', 'puzzle_sudoku', 'puzzle_word_search', 'puzzle_maze', 'puzzle_crossword', 'puzzle_mixed'] },
]

export function NewBookDialog({ orgId, surface, open, onClose, onCreated }: NewBookDialogProps) {
  const formats = useMemo(() => listBookFormats(), [])
  const [formatId, setFormatId] = useState<BookFormatId | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState('')
  const [trimId, setTrimId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const format = formatId ? formats.find((entry) => entry.id === formatId) ?? null : null
  const templates = BOOK_TEMPLATE_PRESETS.filter((preset) => preset.format === formatId)

  function pickFormat(id: BookFormatId) {
    setFormatId(id)
    setTemplateId(null)
    const selected = formats.find((entry) => entry.id === id)
    setTrimId(selected?.defaultTrim ?? '')
  }

  async function create() {
    if (!formatId) return
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const preset = templateId ? getBookTemplatePreset(templateId) : null
      const projectResult = await createBookStudioRecord<{ id: string }>('projects', orgId, {
        title: title.trim(),
        format: formatId,
        trim: trimId ? { presetId: trimId } : undefined,
        stylePrompt: audience.trim() ? `Audience: ${audience.trim()}` : undefined,
        stage: preset?.stage,
        safeSummary: preset && !preset.starterChapters ? preset.description : undefined,
      }, surface)
      if (!projectResult.ok) {
        setError(projectResult.error)
        return
      }
      const projectId = projectResult.data.id
      const starters = preset?.starterChapters ?? []
      for (const [order, chapter] of starters.entries()) {
        await createBookStudioRecord('chapters', orgId, { projectId, title: chapter.title, order }, surface)
      }
      onCreated(projectId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-label="New book" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">New book</h2>

        {!formatId ? (
          <div className="mt-4 space-y-5">
            {FORMAT_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">{group.label}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {group.ids.map((id) => {
                    const entry = formats.find((candidate) => candidate.id === id)
                    if (!entry) return null
                    return (
                      <button key={id} type="button" onClick={() => pickFormat(id)}
                        className="rounded-xl border border-[var(--color-pib-border)] p-3 text-left hover:border-[var(--color-pib-accent)]">
                        <strong className="text-sm text-[var(--color-pib-text)]">{entry.label}</strong>
                        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                          {entry.layout === 'reflowable' ? 'Text chapters' : 'Fixed pages'} · {entry.defaultTrim}&quot; · {entry.assembly.includes('epub') ? 'PDF + EPUB' : 'PDF'}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void create() }}>
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              {format?.label} · <button type="button" className="underline" onClick={() => setFormatId(null)}>change format</button>
            </p>

            {templates.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Start from a template (optional)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {templates.map((preset) => (
                    <button key={preset.id} type="button" onClick={() => setTemplateId(templateId === preset.id ? null : preset.id)}
                      aria-pressed={templateId === preset.id}
                      className={`rounded-full border px-3 py-1 text-sm ${templateId === preset.id ? 'border-[var(--color-pib-accent)] text-[var(--color-pib-text)]' : 'border-[var(--color-pib-border)] text-[var(--color-pib-text-muted)]'}`}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Title</span>
              <input className="input-field w-full" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Audience (optional)</span>
              <input className="input-field w-full" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Who is this book for?" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Trim size</span>
              <select className="input-field w-full" value={trimId} onChange={(event) => setTrimId(event.target.value)}>
                {(format?.supportedTrims ?? []).map((preset) => (
                  <option key={preset} value={preset}>{preset}&quot;</option>
                ))}
              </select>
            </label>

            {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create book'}</button>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Run dialog test — PASS, then commit**

```bash
npx jest __tests__/app/book-studio-new-book-dialog.test.tsx --silent
git add components/book-studio/NewBookDialog.tsx __tests__/app/book-studio-new-book-dialog.test.tsx
git commit -m "feat(book-studio): new-book dialog with format picker and template presets"
```

---

### Task 5: Admin index — Projects tab (default) + Governance tab

**Files:**
- Create: `components/book-studio/BookStudioProjectsIndex.tsx`
- Modify: `app/(admin)/admin/org/[slug]/book-studio/page.tsx`
- Test: `__tests__/app/book-studio-projects-index.test.tsx`
- Check/update: `__tests__/app/book-studio-admin-command-center.test.tsx` (governance workspace itself is unchanged; only its mount moves behind a tab)

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/app/book-studio-projects-index.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BookStudioProjectsIndex } from '@/components/book-studio/BookStudioProjectsIndex'

const listRecords = jest.fn()
jest.mock('@/lib/book-studio/client', () => ({
  ...jest.requireActual('@/lib/book-studio/client'),
  listBookStudioRecords: (...args: unknown[]) => listRecords(...args),
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

describe('BookStudioProjectsIndex', () => {
  beforeEach(() => {
    listRecords.mockResolvedValue({
      ok: true,
      data: { records: [
        { id: 'p1', title: 'Growth Playbook', format: 'nonfiction', stage: 'brief', coverImageUrl: '' },
      ] },
    })
  })

  it('lists projects with format labels and links to the workspace', async () => {
    render(<BookStudioProjectsIndex orgId="org-1" orgSlug="pib" />)
    expect(await screen.findByText('Growth Playbook')).toBeInTheDocument()
    expect(screen.getByText(/Non-fiction/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Growth Playbook/ }))
      .toHaveAttribute('href', '/admin/org/pib/book-studio/p1')
  })

  it('opens the NewBookDialog from the New book button', async () => {
    render(<BookStudioProjectsIndex orgId="org-1" orgSlug="pib" />)
    await screen.findByText('Growth Playbook')
    fireEvent.click(screen.getByRole('button', { name: /New book/i }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: /New book/i })).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/app/book-studio-projects-index.test.tsx --silent` → FAIL.

- [ ] **Step 3: Implement the projects index**

```tsx
// components/book-studio/BookStudioProjectsIndex.tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState, Surface } from '@/components/ui/AppFoundation'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { listBookStudioRecords } from '@/lib/book-studio/client'
import { NewBookDialog } from './NewBookDialog'
import type { BookProject } from './project/types'

type BookStudioProjectsIndexProps = {
  orgId: string
  orgSlug: string
}

export function BookStudioProjectsIndex({ orgId, orgSlug }: BookStudioProjectsIndexProps) {
  const router = useRouter()
  const [projects, setProjects] = useState<BookProject[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listBookStudioRecords<BookProject>('projects', orgId)
    if (result.ok) {
      setProjects(result.data.records ?? [])
      setNotice('')
    } else {
      setNotice(result.error)
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Book projects</h2>
        <button type="button" className="btn-primary" onClick={() => setDialogOpen(true)}>New book</button>
      </div>

      {notice && <Surface role="alert" className="border-red-200 bg-red-50 text-red-900"><p>{notice}</p></Surface>}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading book projects…</p>
      ) : projects.length === 0 ? (
        <EmptyState icon="auto_stories" title="No books yet"
          description="Create your first book — pick a format, optionally start from a template, and begin writing."
          action={<button type="button" className="btn-primary" onClick={() => setDialogOpen(true)}>New book</button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const format = project.format ? getBookFormat(project.format) : null
            return (
              <Link key={project.id} href={`/admin/org/${orgSlug}/book-studio/${project.id}`}
                className="rounded-2xl border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] p-4 hover:border-[var(--color-pib-accent)]">
                {project.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.coverImageUrl} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />
                ) : null}
                <strong className="text-sm text-[var(--color-pib-text)]">{project.title ?? 'Untitled book'}</strong>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  {format?.label ?? project.format ?? 'No format'}{project.stage ? ` · ${project.stage.replace(/_/g, ' ')}` : ''}
                </p>
              </Link>
            )
          })}
        </div>
      )}

      <NewBookDialog orgId={orgId} surface="admin" open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(projectId) => {
          setDialogOpen(false)
          router.push(`/admin/org/${orgSlug}/book-studio/${projectId}`)
        }} />
    </div>
  )
}
```

- [ ] **Step 4: Wire the page with tabs**

Modify `app/(admin)/admin/org/[slug]/book-studio/page.tsx`. The current page renders `AdminBookStudioGovernanceWorkspace` directly. Check how that component resolves `orgId` from `orgSlug` (read the component — it handles slug-or-id resolution internally; follow the same pattern used by `[bookId]/page.tsx`, which resolves slug→org via its existing loader). Wrap both surfaces in a small client component with `PageTabs`:

```tsx
// components/book-studio/BookStudioAdminIndexTabs.tsx
'use client'

import { useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import { AdminBookStudioGovernanceWorkspace } from './AdminBookStudioGovernanceWorkspace'
import { BookStudioProjectsIndex } from './BookStudioProjectsIndex'

export function BookStudioAdminIndexTabs({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const [tab, setTab] = useState<'projects' | 'governance'>('projects')
  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <PageTabs value={tab} onValueChange={(value) => setTab(value as 'projects' | 'governance')}
        tabs={[
          { label: 'Projects', value: 'projects', icon: 'auto_stories' },
          { label: 'Governance', value: 'governance', icon: 'shield' },
        ]} />
      {tab === 'projects'
        ? <BookStudioProjectsIndex orgId={orgId} orgSlug={orgSlug} />
        : <AdminBookStudioGovernanceWorkspace orgSlug={orgSlug} />}
    </div>
  )
}
```

Page file: resolve `orgId` from the slug server-side the same way `[bookId]/page.tsx` does (read that file and copy its slug-or-id resolution), then render `<BookStudioAdminIndexTabs orgId={orgId} orgSlug={slug} />`. If `AdminBookStudioGovernanceWorkspace` needs no orgId, pass only the slug as today.

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/app/book-studio-projects-index.test.tsx __tests__/app/book-studio-admin-command-center.test.tsx --silent`
Expected: PASS. If the command-center suite asserted on the page directly, update its render to mount `AdminBookStudioGovernanceWorkspace` (component-level) rather than the page.

- [ ] **Step 6: Commit**

```bash
git add components/book-studio/BookStudioProjectsIndex.tsx components/book-studio/BookStudioAdminIndexTabs.tsx "app/(admin)/admin/org/[slug]/book-studio/page.tsx" __tests__/app/book-studio-projects-index.test.tsx
git commit -m "feat(book-studio): admin projects index with live create flow; governance moves to tab"
```

---

### Task 6: Workspace capabilities prop + portal project page

**Files:**
- Modify: `components/book-studio/BookProjectWorkspace.tsx`
- Modify: `components/book-studio/project/BookProjectHeader.tsx`
- Modify: `components/book-studio/project/BookProjectChaptersPanel.tsx` (read-only + status gating props — full editor replacement is Task 8)
- Modify: `components/book-studio/project/BookProjectPagesPanel.tsx` (read-only prop)
- Modify: `components/book-studio/BookStudioPortalWorkspace.tsx` (project list + New book + links)
- Create: `app/(portal)/portal/book-studio/[bookId]/page.tsx`
- Test: extend `__tests__/app/book-studio-project-workspace.test.tsx`, `__tests__/app/book-studio-portal-review-surface.test.tsx`

Capability plumbing design:
- `BookProjectWorkspace` gains props: `capabilities: BookStudioCapabilities` and `surface: BookStudioSurface`. Admin mounts pass `surface="admin"` and all-true capabilities (`resolveBookStudioCapabilities(undefined, 'owner', true)`).
- All client helper calls inside the workspace pass `surface` through.
- Projection rules (spec Section 3 table):
  - `canEdit` false → chapters/pages/metadata read-only.
  - `capabilities.isOperator` false → hide Open-in-canvas, Assemble, puzzle generation; show "Request AI draft" button (wired in Task 7) and a gate-status card instead of the Assembly action.
  - Status select offers `approved` only when `canApprovalGates`.
  - Delete buttons only when `canArchiveDelete`.
  - Manifest downloads only when `canPublishingPackets`.

- [ ] **Step 1: Write failing workspace projection tests**

Add to `__tests__/app/book-studio-project-workspace.test.tsx` (follow the suite's existing mock setup for `@/lib/book-studio/client`):

```tsx
const portalCaps = {
  canView: true, canCreate: true, canEdit: true,
  canEvidenceRights: true, canApprovalGates: false,
  canPublishingPackets: false, canArchiveDelete: false, isOperator: false,
}

it('portal editor: hides operator actions, shows request-draft', async () => {
  render(<BookProjectWorkspace orgId="org-1" projectId="proj-1" surface="portal" capabilities={portalCaps} />)
  await screen.findByText(/Content/i)
  expect(screen.queryByRole('button', { name: /Open in canvas/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Assemble/i })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Request AI draft/i })).toBeInTheDocument()
})

it('portal read-only: no editing affordances without canEdit', async () => {
  render(<BookProjectWorkspace orgId="org-1" projectId="proj-1" surface="portal"
    capabilities={{ ...portalCaps, canEdit: false }} />)
  await screen.findByText(/Content/i)
  expect(screen.queryByRole('button', { name: /Add chapter/i })).not.toBeInTheDocument()
})

it('approved status option requires approvalGates', async () => {
  render(<BookProjectWorkspace orgId="org-1" projectId="proj-1" surface="portal" capabilities={portalCaps} />)
  await screen.findByText(/Content/i)
  const statusSelects = screen.queryAllByLabelText(/Status/i)
  for (const select of statusSelects) {
    expect(within(select).queryByRole('option', { name: /approved/i })).not.toBeInTheDocument()
  }
})
```

Run: `npx jest __tests__/app/book-studio-project-workspace.test.tsx --silent` → FAIL (missing props).

- [ ] **Step 2: Implement workspace changes**

In `BookProjectWorkspace.tsx`:

```tsx
import { resolveBookStudioCapabilities, type BookStudioCapabilities } from '@/lib/book-studio/capabilities'
import type { BookStudioSurface } from '@/lib/book-studio/client'

type BookProjectWorkspaceProps = {
  orgId: string
  projectId: string
  surface?: BookStudioSurface
  capabilities?: BookStudioCapabilities
}

export function BookProjectWorkspace({
  orgId, projectId,
  surface = 'admin',
  capabilities = resolveBookStudioCapabilities(undefined, 'owner', true),
}: BookProjectWorkspaceProps) {
```

- Thread `surface` as the final arg into every `listBookStudioRecords` / `createBookStudioRecord` / `patchBookStudioRecord` / `deleteBookStudioRecord` call.
- Pass `capabilities` down to header/panels:
  - `BookProjectHeader`: new props `showOperatorActions={capabilities.isOperator}` and `onRequestDraft` (Task 7); when `showOperatorActions` is false, render "Request AI draft" instead of canvas/assemble buttons.
  - `BookProjectChaptersPanel` / `BookProjectPagesPanel`: new props `readOnly={!capabilities.canEdit}`, `canApprove={capabilities.canApprovalGates}`, `canDelete={capabilities.canArchiveDelete}`. In panels: hide add/edit/save controls when `readOnly`; filter `approved` from status options when `!canApprove`; hide delete buttons when `!canDelete`. Pages panel also hides the puzzle-generate dialog and per-page regenerate unless `capabilities.isOperator`.
  - Assembly tab: render manifest downloads only when `capabilities.canPublishingPackets`; hide the tab entirely for portal users without it (filter the `tabs` array).

- [ ] **Step 3: Portal project page**

```tsx
// app/(portal)/portal/book-studio/[bookId]/page.tsx
import { redirect } from 'next/navigation'
import { BookProjectPortalMount } from '@/components/book-studio/BookProjectPortalMount'

export const dynamic = 'force-dynamic'

export default async function PortalBookProjectPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params
  if (!bookId) redirect('/portal/book-studio')
  return <BookProjectPortalMount projectId={bookId} />
}
```

```tsx
// components/book-studio/BookProjectPortalMount.tsx
'use client'

// Fetches the portal capabilities + org context from the portal list API,
// then mounts the shared workspace with surface="portal".
import { useEffect, useState } from 'react'
import { BookProjectWorkspace } from './BookProjectWorkspace'
import type { BookStudioCapabilities } from '@/lib/book-studio/capabilities'

export function BookProjectPortalMount({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{ capabilities: BookStudioCapabilities; orgId: string } | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch('/api/v1/portal/book-studio/projects')
      const body = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) {
        setNotice(body.error ?? 'Book Studio is not available.')
        return
      }
      const data = body.data ?? body
      setState({ capabilities: data.capabilities, orgId: data.orgId ?? '' })
    }
    void load()
    return () => { cancelled = true }
  }, [])

  if (notice) return <main className="p-6 text-sm text-[var(--color-pib-text-muted)]">{notice}</main>
  if (!state) return <main className="p-6 text-sm text-[var(--color-pib-text-muted)]">Loading…</main>
  return <BookProjectWorkspace orgId={state.orgId} projectId={projectId} surface="portal" capabilities={state.capabilities} />
}
```

For this to work the portal list route from Task 2 must include `orgId` and the full capability object in its response — extend the Task 2 GET response: `apiSuccess({ resource, records, capabilities: caps, orgId })`.

- [ ] **Step 4: Portal list page upgrade**

In `BookStudioPortalWorkspace.tsx`:
- Fetch from the new `/api/v1/portal/book-studio/projects` (full capabilities + records) instead of only the legacy summary route.
- Render project cards linking to `/portal/book-studio/[id]` with a "Continue writing" affordance when `capabilities.canEdit`.
- "New book" button when `capabilities.canCreate`, opening `NewBookDialog` with `surface="portal"`.
- Keep the "Manual release posture" note, condensed to a single card below the list; delete the three disabled-action stub buttons.

Update `__tests__/app/book-studio-portal-review-surface.test.tsx` accordingly (new fetch target and link assertions).

- [ ] **Step 5: Run the affected suites**

Run: `npx jest __tests__/app/book-studio-project-workspace.test.tsx __tests__/app/book-studio-portal-review-surface.test.tsx __tests__/api/portal-book-studio-resources.test.ts --silent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/book-studio "app/(portal)/portal/book-studio" __tests__/app
git commit -m "feat(book-studio): shared workspace capability projection + portal authoring mount"
```

---

### Task 7: Request-AI-draft route + button wiring

**Files:**
- Create: `app/api/v1/portal/book-studio/projects/[id]/request-draft/route.ts`
- Modify: `components/book-studio/project/BookProjectHeader.tsx` (button onClick), `lib/book-studio/client.ts` (helper)
- Test: `__tests__/api/portal-book-studio-request-draft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/portal-book-studio-request-draft.test.ts
// Mock setup: same middleware + adminDb pattern as portal-book-studio-resources.test.ts,
// plus a `tasks` collection and query support for the duplicate-open-request check.
// (Copy the mock block and add: db.collections.tasks = {}; extend `where` to filter
//  by the fields used below when name === 'tasks'.)

import { POST } from '@/app/api/v1/portal/book-studio/projects/[id]/request-draft/route'

it('creates a book-studio draft task and decision log', async () => {
  const res = await POST(
    jsonRequest('POST', { unitType: 'chapter', unitId: 'chap-1', note: 'expand this' }) as any,
    { params: Promise.resolve({ id: 'proj-1' }) } as any,
  )
  expect(res.status).toBe(201)
  const tasks = Object.values(db.collections.tasks)
  expect(tasks).toHaveLength(1)
  expect(tasks[0]).toMatchObject({
    orgId: 'org-1',
    tags: expect.arrayContaining(['book-studio', 'ai-draft-request']),
    status: 'todo',
  })
  expect(Object.values(db.collections.book_studio_decision_logs ?? {})).toHaveLength(1)
})

it('409s when an open request already exists for the unit', async () => {
  await POST(jsonRequest('POST', { unitType: 'chapter', unitId: 'chap-1' }) as any,
    { params: Promise.resolve({ id: 'proj-1' }) } as any)
  const res = await POST(jsonRequest('POST', { unitType: 'chapter', unitId: 'chap-1' }) as any,
    { params: Promise.resolve({ id: 'proj-1' }) } as any)
  expect(res.status).toBe(409)
})

it('404s for a project in another org', async () => {
  db.collections.book_studio_projects['proj-x'] = { orgId: 'other-org', title: 'X' }
  const res = await POST(jsonRequest('POST', { unitType: 'cover' }) as any,
    { params: Promise.resolve({ id: 'proj-x' }) } as any)
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: Run to verify failure, then implement**

Before implementing, read `app/api/v1/tasks/route.ts` (or the tasks lib it uses) to confirm the canonical task document shape (`title`, `status`, `orgId`, `tags`, `assignee`, `linkedResource`, actor fields) and match it exactly — do not invent fields. Implementation:

```ts
// app/api/v1/portal/book-studio/projects/[id]/request-draft/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { resolveBookStudioCapabilities } from '@/lib/book-studio/capabilities'
import { portalBookStudioGuard, portalActorFields } from '@/lib/book-studio/portal'

export const dynamic = 'force-dynamic'

const UNIT_TYPES = new Set(['chapter', 'page', 'cover', 'research'])

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: { params: Promise<{ id: string }> }) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }
  const unitType = typeof body.unitType === 'string' && UNIT_TYPES.has(body.unitType) ? body.unitType : ''
  if (!unitType) return apiError('unitType must be one of chapter, page, cover, research', 400)
  const unitId = typeof body.unitId === 'string' ? body.unitId.trim() : ''
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : ''

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps.canEdit) return apiError('Your role does not have access to this Book Studio action', 403)

  const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
  const project = projectSnap.exists ? projectSnap.data() ?? {} : null
  if (!project || project.orgId !== orgId || project.deleted === true) {
    return apiError('Book project not found', 404)
  }

  // Reject duplicate open requests for the same unit.
  const requestKey = `book-draft:${projectId}:${unitType}:${unitId || 'project'}`
  const existing = await adminDb.collection('tasks')
    .where('orgId', '==', orgId)
    .where('requestKey', '==', requestKey)
    .where('status', 'in', ['todo', 'in_progress'])
    .get()
  if (!existing.empty) {
    return apiError('An AI draft request for this item is already open', 409)
  }

  const taskRef = await adminDb.collection('tasks').add({
    orgId,
    title: `AI draft request: ${project.title ?? 'book project'} — ${unitType}${unitId ? ` ${unitId}` : ''}`,
    description: note || `Client requested an AI draft for ${unitType} on book project ${projectId}.`,
    status: 'todo',
    tags: ['book-studio', 'ai-draft-request'],
    requestKey,
    linkedResource: { type: 'book_studio_project', id: projectId, unitType, unitId: unitId || null },
    ...portalActorFields(uid),
  })

  await adminDb.collection('book_studio_decision_logs').add({
    orgId,
    projectId,
    title: 'AI draft requested from portal',
    safeSummary: `Client requested an AI draft (${unitType}${unitId ? ` ${unitId}` : ''}). Task ${taskRef.id}.`,
    ...portalActorFields(uid),
  })

  return apiSuccess({ taskId: taskRef.id, requestKey }, 201)
})
```

Client helper in `lib/book-studio/client.ts`:

```ts
export function requestBookStudioDraft<T>(projectId: string, payload: { unitType: 'chapter' | 'page' | 'cover' | 'research'; unitId?: string; note?: string }) {
  return request<T>(`/api/v1/portal/book-studio/projects/${encodeURIComponent(projectId)}/request-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
```

Header wiring: `BookProjectHeader`'s "Request AI draft" button (shown when `!showOperatorActions`) calls `requestBookStudioDraft(projectId, { unitType: 'cover' })` for the project-level button; the chapter editor gets a per-chapter variant in Task 8. Show success/409 as an inline notice.

- [ ] **Step 3: Run tests → PASS, commit**

```bash
npx jest __tests__/api/portal-book-studio-request-draft.test.ts --silent
git add app/api/v1/portal/book-studio lib/book-studio/client.ts components/book-studio/project/BookProjectHeader.tsx __tests__/api/portal-book-studio-request-draft.test.ts
git commit -m "feat(book-studio): portal request-AI-draft creates a governed task, never dispatches"
```

---

### Task 8: TipTap chapter editor

**Files:**
- Create: `components/book-studio/project/ChapterEditor.tsx`
- Rewrite: `components/book-studio/project/BookProjectChaptersPanel.tsx` (becomes sidebar + editor layout, keeps its name and public props)
- Test: `__tests__/app/book-studio-chapter-editor.test.tsx`

Pattern reference: `components/blog-editor/BlogEditor.tsx` (TipTap `useEditor`, `tiptap-markdown` round-trip, refresh-on-parent-reload effect). Reuse its extension config.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/app/book-studio-chapter-editor.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BookProjectChaptersPanel } from '@/components/book-studio/project/BookProjectChaptersPanel'

// TipTap needs a real contenteditable environment; jsdom works with
// @tiptap/react as proven by the existing BlogEditor tests — copy any
// editor-related jest setup/mocks from __tests__ that cover BlogEditor.

const chapters = [
  { id: 'c1', title: 'One', order: 0, body: '# Heading\n\nHello world', status: 'generated' as const, wordCount: 3 },
  { id: 'c2', title: 'Two', order: 1, body: '', status: 'draft' as const },
]

function renderPanel(overrides: Partial<Parameters<typeof BookProjectChaptersPanel>[0]> = {}) {
  const props = {
    chapters,
    onEditBody: jest.fn().mockResolvedValue(undefined),
    onEditStatus: jest.fn().mockResolvedValue(undefined),
    onAddChapter: jest.fn().mockResolvedValue(undefined),
    addingChapter: false,
    readOnly: false,
    canApprove: true,
    canDelete: true,
    ...overrides,
  }
  render(<BookProjectChaptersPanel {...props} />)
  return props
}

describe('chapter editor', () => {
  it('renders the chapter sidebar with word counts and statuses', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /One/ })).toBeInTheDocument()
    expect(screen.getByText(/3 words/)).toBeInTheDocument()
  })

  it('autosaves edits and promotes generated → edited', async () => {
    jest.useFakeTimers()
    const props = renderPanel()
    const editable = await screen.findByRole('textbox')
    fireEvent.input(editable, { target: { textContent: 'Rewritten text' } })
    act(() => { jest.advanceTimersByTime(2500) })
    await waitFor(() => expect(props.onEditBody).toHaveBeenCalled())
    expect(props.onEditStatus).toHaveBeenCalledWith('c1', 'edited')
    jest.useRealTimers()
  })

  it('read-only mode disables editing and add', () => {
    renderPanel({ readOnly: true })
    expect(screen.queryByRole('button', { name: /Add chapter/i })).not.toBeInTheDocument()
  })

  it('hides approved status without canApprove', () => {
    renderPanel({ canApprove: false })
    expect(screen.queryByRole('option', { name: /approved/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/app/book-studio-chapter-editor.test.tsx --silent` → FAIL.

- [ ] **Step 3: Implement ChapterEditor**

```tsx
// components/book-studio/project/ChapterEditor.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

type ChapterEditorProps = {
  chapterId: string
  initialMarkdown: string
  readOnly: boolean
  onSave: (chapterId: string, markdown: string) => Promise<void> | void
  onDirtyChange?: (dirty: boolean) => void
}

const AUTOSAVE_MS = 2000

export function ChapterEditor({ chapterId, initialMarkdown, readOnly, onSave, onDirtyChange }: ChapterEditorProps) {
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestMarkdown = useRef(initialMarkdown)

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write this chapter. Markdown shortcuts work.' }),
      Markdown.configure({ transformPastedText: true }),
    ],
    content: initialMarkdown,
    onUpdate({ editor: instance }) {
      latestMarkdown.current = (instance.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
      setSaveState('dirty')
      onDirtyChange?.(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { void flush() }, AUTOSAVE_MS)
    },
  })

  async function flush() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setSaveState('saving')
    await onSave(chapterId, latestMarkdown.current)
    setSaveState('saved')
    onDirtyChange?.(false)
  }

  // Switching chapters replaces content; flush pending edits first.
  useEffect(() => {
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); void flush() } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  useEffect(() => {
    if (!editor) return
    latestMarkdown.current = initialMarkdown
    editor.commands.setContent(initialMarkdown)
    setSaveState('idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, editor])

  if (!editor) return null

  const toolbarButton = (label: string, active: boolean, run: () => void) => (
    <button type="button" aria-pressed={active} onClick={run} disabled={readOnly}
      className={`rounded px-2 py-1 text-xs ${active ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-text)]' : 'text-[var(--color-pib-text-muted)]'}`}>
      {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-pib-border)] pb-2">
        {toolbarButton('H1', editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        {toolbarButton('H2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {toolbarButton('H3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        {toolbarButton('B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {toolbarButton('I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
        {toolbarButton('• List', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
        {toolbarButton('1. List', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
        {toolbarButton('❝', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
        {toolbarButton('―', false, () => editor.chain().focus().setHorizontalRule().run())}
        {toolbarButton('↺', false, () => editor.chain().focus().undo().run())}
        {toolbarButton('↻', false, () => editor.chain().focus().redo().run())}
        <span className="ml-auto text-xs text-[var(--color-pib-text-muted)]">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'dirty' ? 'Unsaved changes' : ''}
        </span>
      </div>
      <EditorContent editor={editor} className="prose prose-invert mt-3 min-h-[50vh] max-w-none flex-1 focus:outline-none" onBlur={() => { if (saveState === 'dirty') void flush() }} />
    </div>
  )
}
```

- [ ] **Step 4: Rewrite BookProjectChaptersPanel as sidebar + editor**

Keep the exported name and extend props:

```tsx
// components/book-studio/project/BookProjectChaptersPanel.tsx
'use client'

import { useMemo, useState } from 'react'
import { Surface } from '@/components/ui/AppFoundation'
import { ChapterEditor } from './ChapterEditor'
import type { BookChapter } from './types'

type BookProjectChaptersPanelProps = {
  chapters: BookChapter[]
  onEditBody: (chapterId: string, body: string) => void | Promise<void>
  onEditStatus: (chapterId: string, status: BookChapter['status']) => void | Promise<void>
  onAddChapter: (title: string) => void | Promise<void>
  addingChapter: boolean
  readOnly?: boolean
  canApprove?: boolean
  canDelete?: boolean
  onDeleteChapter?: (chapterId: string) => void | Promise<void>
  onRequestDraft?: (chapterId: string) => void | Promise<void>  // portal-only affordance
}

const STATUS_OPTIONS: BookChapter['status'][] = ['draft', 'generated', 'edited', 'approved']

function countWords(markdown: string) {
  return markdown.trim() ? markdown.trim().split(/\s+/).length : 0
}

export function BookProjectChaptersPanel({
  chapters, onEditBody, onEditStatus, onAddChapter, addingChapter,
  readOnly = false, canApprove = true, canDelete = true, onDeleteChapter, onRequestDraft,
}: BookProjectChaptersPanelProps) {
  const ordered = useMemo(() => [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [chapters])
  const [selectedId, setSelectedId] = useState<string | null>(ordered[0]?.id ?? null)
  const [newTitle, setNewTitle] = useState('')
  const selected = ordered.find((chapter) => chapter.id === selectedId) ?? ordered[0] ?? null

  const totalWords = ordered.reduce((sum, chapter) => sum + (chapter.wordCount ?? countWords(chapter.body ?? '')), 0)
  const statusOptions = canApprove ? STATUS_OPTIONS : STATUS_OPTIONS.filter((status) => status !== 'approved')

  async function saveBody(chapterId: string, markdown: string) {
    await onEditBody(chapterId, markdown)
    const chapter = ordered.find((entry) => entry.id === chapterId)
    if (chapter?.status === 'generated') await onEditStatus(chapterId, 'edited')
  }

  return (
    <Surface>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          {ordered.map((chapter) => (
            <button key={chapter.id} type="button" onClick={() => setSelectedId(chapter.id)}
              className={`block w-full rounded-xl border p-3 text-left ${selected?.id === chapter.id ? 'border-[var(--color-pib-accent)]' : 'border-[var(--color-pib-border)]'}`}>
              <strong className="text-sm text-[var(--color-pib-text)]">{chapter.title || 'Untitled chapter'}</strong>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                {(chapter.wordCount ?? countWords(chapter.body ?? ''))} words · {chapter.status ?? 'draft'}
              </p>
            </button>
          ))}

          {!readOnly && (
            <form className="flex gap-2" onSubmit={(event) => {
              event.preventDefault()
              if (!newTitle.trim()) return
              void onAddChapter(newTitle.trim())
              setNewTitle('')
            }}>
              <input className="input-field w-full" placeholder="New chapter title" value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)} />
              <button type="submit" className="btn-secondary" disabled={addingChapter}>Add chapter</button>
            </form>
          )}
          <p className="text-xs text-[var(--color-pib-text-muted)]">{totalWords} words total</p>
        </aside>

        <div>
          {selected ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                  Status
                  <select aria-label="Status" className="input-field" value={selected.status ?? 'draft'} disabled={readOnly}
                    onChange={(event) => void onEditStatus(selected.id, event.target.value as BookChapter['status'])}>
                    {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <div className="flex gap-2">
                  {onRequestDraft && !readOnly && (
                    <button type="button" className="btn-secondary" onClick={() => void onRequestDraft(selected.id)}>Request AI draft</button>
                  )}
                  {canDelete && onDeleteChapter && (
                    <button type="button" className="btn-secondary" onClick={() => void onDeleteChapter(selected.id)}>Delete</button>
                  )}
                </div>
              </div>
              <ChapterEditor key={selected.id} chapterId={selected.id}
                initialMarkdown={selected.body ?? ''} readOnly={readOnly} onSave={saveBody} />
            </>
          ) : (
            <p className="text-sm text-[var(--color-pib-text-muted)]">Add a chapter to start writing.</p>
          )}
        </div>
      </div>
    </Surface>
  )
}
```

Wire in `BookProjectWorkspace`: pass `onDeleteChapter` (existing delete helper via `deleteBookStudioRecord('chapters', …, surface)`), `onRequestDraft` only when `surface === 'portal'` (calls `requestBookStudioDraft(projectId, { unitType: 'chapter', unitId })`). Also persist word count on save: extend `editChapterBody` to `patchBookStudioRecord('chapters', chapterId, orgId, { body, wordCount: body.trim() ? body.trim().split(/\s+/).length : 0 }, surface)`.

- [ ] **Step 5: Run the suites**

Run: `npx jest __tests__/app/book-studio-chapter-editor.test.tsx __tests__/app/book-studio-project-workspace.test.tsx --silent`
Expected: PASS. If jsdom chokes on TipTap, copy the setup used by the existing BlogEditor test (check `__tests__` for it: `grep -rl "BlogEditor" __tests__/`) — including any `ClipboardEvent`/`Range` polyfills in `jest.setup`.

- [ ] **Step 6: Commit**

```bash
git add components/book-studio/project __tests__/app/book-studio-chapter-editor.test.tsx
git commit -m "feat(book-studio): TipTap chapter editor with sidebar, autosave, and status gating"
```

---

### Task 9: Full verification + push

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Affected test suites**

Run: `npx jest __tests__/lib/book-studio __tests__/api/portal-book-studio-resources.test.ts __tests__/api/portal-book-studio.test.ts __tests__/api/portal-book-studio-request-draft.test.ts __tests__/api/book-studio-data-api.test.ts __tests__/app/book-studio-project-workspace.test.tsx __tests__/app/book-studio-portal-review-surface.test.tsx __tests__/app/book-studio-admin-command-center.test.tsx __tests__/app/book-studio-new-book-dialog.test.tsx __tests__/app/book-studio-projects-index.test.tsx __tests__/app/book-studio-chapter-editor.test.tsx --silent`
Expected: all PASS.

- [ ] **Step 3: Lint gates**

Run: `npm run lint && npm run lint:ratchet && git diff --check`
Expected: exit 0 (existing warnings tolerated; ratchet must not regress — no new empty catches).

- [ ] **Step 4: Live smoke on :3010**

Start dev server, then walk: admin org Book Studio → Projects tab → New book (Lead magnet template) → workspace opens → write in a chapter, watch autosave → status flips generated→edited on AI-synced content only. Portal: log in as a member of an org with the module enabled → Book Studio → New book → edit chapter → Request AI draft → confirm task appears in the org's tasks and a second request 409s.

- [ ] **Step 5: Push**

```bash
git push origin development
```

---

## Plan 2 preview (do NOT start until Plan 1 is verified)

Slices 5–11 from the spec: KDP/Google taxonomy + store-listing metadata UI, ISBN split + front/back matter + packet pricing, chapter comment threads, research tab, portal fixture-leak backfill, series create-next-volume, skills/wiki updates. Also carried into Plan 2 from spec Section 4: the trim-size-aware page preview toggle in the chapter editor (deferred so Plan 1 ships the core editor sooner).

# Creative Canvas Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 PiB Creative Canvas foundation: tenant-scoped graph records, run/provenance contracts, provider registry, APIs, minimal graph UI, and Social draft export gate.

**Architecture:** Implement a small core domain in `lib/creative-canvas` first, then expose it through `/api/v1/creative-canvas`, then add admin/portal workspace UI. Store V1 graph nodes and edges embedded on the canvas document for fast delivery, with run/export records in separate collections.

**Tech Stack:** Next.js App Router, React, Firestore Admin SDK, TypeScript, Jest, existing PiB API/auth helpers, `@xyflow/react` for the graph UI.

## Global Constraints

- Work on `development`; never implement this directly on `main`.
- Preserve existing module ownership: Social, Campaigns, Documents, Research, YouTube Studio, Book Studio, and workspace artifacts stay source-of-truth modules.
- Canvas V1 may create internal drafts and artifacts only; no publish, schedule, share, spend, external Drive share, YouTube publish, store/book publish, secret, credential, or destructive action.
- Every record must be tenant-scoped with `orgId`.
- Agent writes must store `agentId`, safe summary, source references, and output references.
- Higgsfield CLI/MCP must be treated as credit-metered unless Higgsfield confirms otherwise.
- V1 ships Social draft export first; other export adapters can expose contracts but must not pretend to be implemented.

---

### Task 1: Core Types, Sanitizers, Provider Registry

**Files:**
- Create: `lib/creative-canvas/types.ts`
- Create: `lib/creative-canvas/sanitize.ts`
- Create: `lib/creative-canvas/providers.ts`
- Test: `__tests__/lib/creative-canvas/sanitize.test.ts`
- Test: `__tests__/lib/creative-canvas/providers.test.ts`

**Interfaces:**
- Produces: `CreativeCanvas`, `CreativeCanvasNode`, `CreativeCanvasEdge`, `CreativeCanvasRun`, `CreativeCanvasExport`
- Produces: `sanitizeCreativeCanvasInput(input, orgId, actor): CreativeCanvasInput`
- Produces: `sanitizeCreativeCanvasGraph(input, orgId): CreativeCanvasGraph`
- Produces: `getCreativeCanvasProvider(key): CreativeCanvasProvider | null`
- Produces: `listCreativeCanvasProviders(): CreativeCanvasProvider[]`

- [ ] **Step 1: Write failing sanitizer tests**

```ts
import {
  sanitizeCreativeCanvasGraph,
  sanitizeCreativeCanvasInput,
} from '@/lib/creative-canvas/sanitize'

describe('creative canvas sanitizers', () => {
  it('normalizes a canvas input with org and actor metadata', () => {
    const input = sanitizeCreativeCanvasInput(
      { title: ' Launch Pack ', purpose: 'Product launch', visibility: 'admin_agents_clients' },
      'org-1',
      { uid: 'user-1', type: 'user' },
    )

    expect(input).toMatchObject({
      orgId: 'org-1',
      title: 'Launch Pack',
      purpose: 'Product launch',
      status: 'draft',
      visibility: 'admin_agents_clients',
      createdBy: 'user-1',
      createdByType: 'user',
      updatedBy: 'user-1',
      updatedByType: 'user',
      activeVersion: 1,
      deleted: false,
    })
  })

  it('rejects cross-org graph nodes and unsafe urls', () => {
    expect(() =>
      sanitizeCreativeCanvasGraph({
        nodes: [{
          id: 'source-1',
          orgId: 'other-org',
          type: 'source',
          title: 'Source',
          position: { x: 0, y: 0 },
          data: {},
          source: { kind: 'url', url: 'javascript:alert(1)' },
        }],
        edges: [],
      }, 'org-1'),
    ).toThrow('node source-1 does not belong to organisation')
  })

  it('keeps graph nodes and edges tenant-scoped', () => {
    const graph = sanitizeCreativeCanvasGraph({
      nodes: [
        { id: 'source-1', type: 'source', title: 'Source', position: { x: 10, y: 20 }, data: { note: 'brief' } },
        { id: 'prompt-1', type: 'prompt', title: 'Prompt', position: { x: 300, y: 20 }, data: { promptSummary: 'Create a launch image' } },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1', label: 'context' }],
    }, 'org-1')

    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes[0]).toMatchObject({ orgId: 'org-1', type: 'source' })
    expect(graph.edges[0]).toMatchObject({ orgId: 'org-1', sourceNodeId: 'source-1', targetNodeId: 'prompt-1' })
  })
})
```

- [ ] **Step 2: Write failing provider tests**

```ts
import {
  getCreativeCanvasProvider,
  listCreativeCanvasProviders,
} from '@/lib/creative-canvas/providers'

describe('creative canvas provider registry', () => {
  it('lists V1 providers with risk and approval metadata', () => {
    const providers = listCreativeCanvasProviders()
    expect(providers.map((provider) => provider.key)).toEqual(['manual_upload', 'xai', 'higgsfield', 'agent_task'])
    expect(getCreativeCanvasProvider('higgsfield')).toMatchObject({
      key: 'higgsfield',
      usesExternalCredits: true,
      requiresApprovalBeforeClientVisibility: true,
      ownerAgentId: 'maya',
    })
  })

  it('returns null for unknown providers', () => {
    expect(getCreativeCanvasProvider('unknown')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/sanitize.test.ts __tests__/lib/creative-canvas/providers.test.ts`

Expected: FAIL because `lib/creative-canvas/*` does not exist.

- [ ] **Step 4: Implement core files**

Create the types, sanitizers, and provider registry matching the test imports and preserving the spec vocabulary.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/sanitize.test.ts __tests__/lib/creative-canvas/providers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/creative-canvas __tests__/lib/creative-canvas docs/superpowers/plans/2026-06-19-creative-canvas-foundation.md
git commit -m "feat(canvas): add creative canvas domain contracts"
```

### Task 2: Firestore Store And API Routes

**Files:**
- Create: `lib/creative-canvas/store.ts`
- Create: `app/api/v1/creative-canvas/route.ts`
- Create: `app/api/v1/creative-canvas/[id]/route.ts`
- Create: `app/api/v1/creative-canvas/[id]/graph/route.ts`
- Test: `__tests__/lib/creative-canvas/store.test.ts`
- Test: `__tests__/app/api/creative-canvas-route.test.ts`

**Interfaces:**
- Consumes: Task 1 sanitizers and types.
- Produces: `CREATIVE_CANVAS_COLLECTION = 'creative_canvases'`
- Produces: `createCreativeCanvas(input, orgId, actor): Promise<CreativeCanvas>`
- Produces: `listCreativeCanvases(orgId): Promise<CreativeCanvas[]>`
- Produces: `updateCreativeCanvasGraph(id, orgId, graph, actor): Promise<CreativeCanvas>`

- [ ] **Step 1: Write store tests**

Test create/list/update with mocked `adminDb.collection('creative_canvases')`, proving org filtering and activeVersion increment on graph save.

- [ ] **Step 2: Implement store helpers**

Use existing Firestore Admin patterns from `lib/book-studio/routes.ts` and `lib/workspace-os/artifacts.ts`; do not expose cross-org records.

- [ ] **Step 3: Implement API routes**

`GET /api/v1/creative-canvas` lists tenant canvases. `POST /api/v1/creative-canvas` creates one. `GET/PATCH /api/v1/creative-canvas/[id]` reads/updates metadata. `PUT /api/v1/creative-canvas/[id]/graph` saves nodes/edges.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/store.test.ts __tests__/app/api/creative-canvas-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/creative-canvas app/api/v1/creative-canvas __tests__/lib/creative-canvas __tests__/app/api/creative-canvas-route.test.ts
git commit -m "feat(canvas): add creative canvas API"
```

### Task 3: Run Records And Agent Bridge Guard

**Files:**
- Create: `lib/creative-canvas/runs.ts`
- Create: `lib/creative-canvas/agent-bridge.ts`
- Create: `app/api/v1/creative-canvas/[id]/runs/route.ts`
- Test: `__tests__/lib/creative-canvas/runs.test.ts`

**Interfaces:**
- Produces: `createCreativeCanvasRun(input, orgId, actor): Promise<CreativeCanvasRun>`
- Produces: `buildCreativeCanvasAgentTask(run, canvas): AgentTaskDraft`

- [ ] **Step 1: Write run guard tests**

Test that Higgsfield runs are queued as reviewable internal runs, store provider metadata, and do not expose outputs client-visible.

- [ ] **Step 2: Implement run helpers and route**

Create run documents in `creative_canvas_runs`; for V1, return a queued run with provider metadata and a task-draft payload for later watcher integration.

- [ ] **Step 3: Run focused tests**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/runs.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/creative-canvas app/api/v1/creative-canvas __tests__/lib/creative-canvas/runs.test.ts
git commit -m "feat(canvas): add creative canvas run records"
```

### Task 4: Social Draft Export Guard

**Files:**
- Create: `lib/creative-canvas/exporters/social.ts`
- Create: `app/api/v1/creative-canvas/[id]/exports/social-draft/route.ts`
- Test: `__tests__/lib/creative-canvas/social-export.test.ts`

**Interfaces:**
- Produces: `buildSocialDraftFromCanvasOutput(input): SocialDraftPayload`
- Produces: `assertCanvasOutputCanExportToSocial(node): void`

- [ ] **Step 1: Write export guard tests**

Test blocked review state, missing output, org mismatch, and a successful draft payload for text/image output.

- [ ] **Step 2: Implement Social draft builder**

Create draft payload only. Do not call publish or schedule routes. Include `sourceCanvasId`, `sourceNodeId`, and synthetic-media metadata.

- [ ] **Step 3: Run focused tests**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/social-export.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/creative-canvas/exporters app/api/v1/creative-canvas __tests__/lib/creative-canvas/social-export.test.ts
git commit -m "feat(canvas): add social draft export guard"
```

### Task 5: Minimal Graph UI And Routes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `components/creative-canvas/CreativeCanvasWorkspace.tsx`
- Create: `components/creative-canvas/CreativeCanvasNode.tsx`
- Create: `components/creative-canvas/CreativeCanvasInspector.tsx`
- Create: `app/(portal)/portal/creative-canvas/page.tsx`
- Create: `app/(admin)/admin/creative-canvas/page.tsx`
- Test: `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

**Interfaces:**
- Consumes: API routes from Task 2.
- Produces: user can create/open a canvas, add nodes, connect them, save/reload, and see run/export status placeholders.

- [ ] **Step 1: Install graph dependency**

Run: `npm install @xyflow/react`

- [ ] **Step 2: Write UI smoke test**

Render `CreativeCanvasWorkspace` with mocked fetch calls and assert the node palette, canvas title, save button, and inspector render.

- [ ] **Step 3: Implement workspace UI**

Use `@xyflow/react` for the center graph, a left node palette, and a right inspector. Use existing portal scoped-routing patterns for `orgId`.

- [ ] **Step 4: Run focused UI test and typecheck**

Run: `npm test -- --runTestsByPath __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components/creative-canvas app/'(portal)'/portal/creative-canvas app/'(admin)'/admin/creative-canvas __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx
git commit -m "feat(canvas): add creative canvas workspace UI"
```

### Task 6: Final Policy Verification And Wiki Closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-06-19-creative-canvas-foundation.md`
- Modify: Partners wiki/hot/log files.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified V1 foundation pushed to `origin/development`.

- [ ] **Step 1: Run verification**

Run:

```bash
npm test -- --runTestsByPath \
  __tests__/lib/creative-canvas/sanitize.test.ts \
  __tests__/lib/creative-canvas/providers.test.ts \
  __tests__/lib/creative-canvas/store.test.ts \
  __tests__/lib/creative-canvas/runs.test.ts \
  __tests__/lib/creative-canvas/social-export.test.ts \
  __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx
npm run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Push**

```bash
git push origin development
```

- [ ] **Step 3: Update wiki**

Update the Partners hot cache, index, daily log, and topical note with implementation commits, verification results, and remaining V2/V3 scope.

## Self-Review

- Spec coverage: V1 graph, data model, providers, agent bridge, Social draft export, UI routes, tests, and approval guardrails are covered.
- Intentional V1 gaps: full Higgsfield execution, Book Studio export, YouTube Studio export, rich video timeline editing, live collaboration, and provider cost dashboards remain V2/V3 items from the spec.
- Placeholder scan: no `TBD`, `TODO`, or undefined step is required for Task 1. Later tasks name exact deliverables and test targets, but should be expanded further if delegated to separate agents.
- Type consistency: Task names match the design spec vocabulary and the planned `lib/creative-canvas` interfaces.

# Creative Canvas Full Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the V1 Creative Canvas foundation into the full PiB canvas workflow: saved versions, collaboration comments, output attachment, review gates, rich workspace controls, and safe draft adapters for social, documents/blogs, campaigns, YouTube Studio, Book Studio, and workspace artifacts.

**Architecture:** Keep `creative_canvases` as the current graph document, add append-only supporting collections for versions/comments/exports, and add focused API routes for output ingestion, review updates, comments, version history, and draft exports. UI remains one workspace shell backed by typed helpers so admin and portal surfaces can share the canvas while enforcing safe copy and approval-gated actions.

**Tech Stack:** Next.js App Router, React, `@xyflow/react`, Firestore Admin SDK, TypeScript, Jest, existing PiB `withAuth`/tenant helpers.

## Global Constraints

- Work on `development`; never implement directly on `main`.
- No production deploy, preview promotion, publishing, scheduling, client-visible sharing, ad launch/spend, YouTube publishing, store/book publishing, Drive ACL mutation, secret/config mutation, destructive action, or live backfill without explicit Peet approval.
- Every canvas, version, comment, run, output, review, and export record must carry `orgId`.
- Every export adapter in this plan creates internal draft payloads or draft records only.
- Higgsfield CLI/MCP remains credit-metered unless Higgsfield confirms otherwise.
- Prompt/raw provider data must be summarized before client visibility.

---

### Task 1: Version Snapshots, Comments, Output Attachments, Review Updates

**Files:**
- Modify: `lib/creative-canvas/types.ts`
- Modify: `lib/creative-canvas/sanitize.ts`
- Modify: `lib/creative-canvas/store.ts`
- Create: `lib/creative-canvas/collaboration.ts`
- Create: `app/api/v1/creative-canvas/[id]/versions/route.ts`
- Create: `app/api/v1/creative-canvas/[id]/comments/route.ts`
- Create: `app/api/v1/creative-canvas/[id]/nodes/[nodeId]/output/route.ts`
- Create: `app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route.ts`
- Test: `__tests__/lib/creative-canvas/collaboration.test.ts`
- Test: `__tests__/app/api/creative-canvas-collaboration-route.test.ts`

**Interfaces:**
- Produces: `CreativeCanvasVersion`, `CreativeCanvasComment`, `CreativeCanvasReviewPatch`, `CreativeCanvasOutputPatch`
- Produces: `listCreativeCanvasVersions(canvasId, orgId)`
- Produces: `createCreativeCanvasComment(canvasId, orgId, input, actor)`
- Produces: `attachCreativeCanvasNodeOutput(canvasId, orgId, nodeId, input, actor)`
- Produces: `updateCreativeCanvasNodeReview(canvasId, orgId, nodeId, input, actor)`

- [ ] **Step 1: Write failing collaboration tests**

```ts
it('creates graph versions when the graph changes', async () => {
  const canvas = await updateCreativeCanvasGraph('canvas-1', 'org-1', graph, { uid: 'u1', type: 'user' })
  const versions = await listCreativeCanvasVersions('canvas-1', 'org-1')
  expect(canvas.activeVersion).toBe(2)
  expect(versions[0]).toMatchObject({ canvasId: 'canvas-1', orgId: 'org-1', version: 2 })
})

it('attaches reviewed output to a node without making it client visible', async () => {
  const updated = await attachCreativeCanvasNodeOutput('canvas-1', 'org-1', 'output-1', {
    kind: 'image',
    url: 'https://cdn.example.com/output.png',
    thumbnailUrl: 'https://cdn.example.com/thumb.png',
    textPreview: 'Launch hero',
    review: { status: 'needed', syntheticMediaDisclosure: true, rightsStatus: 'needs_review', brandStatus: 'needs_review' },
  }, { uid: 'agent:maya', type: 'agent' })
  expect(updated.nodes[0].output?.url).toBe('https://cdn.example.com/output.png')
  expect(updated.nodes[0].review?.status).toBe('needed')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/collaboration.test.ts __tests__/app/api/creative-canvas-collaboration-route.test.ts`

Expected: FAIL because collaboration helpers/routes do not exist.

- [ ] **Step 3: Implement types, sanitizers, store helpers, and routes**

Add append-only `creative_canvas_versions` and `creative_canvas_comments` collections. Output/review routes update only the selected node after validating org ownership and safe URLs.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/collaboration.test.ts __tests__/app/api/creative-canvas-collaboration-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/creative-canvas app/api/v1/creative-canvas __tests__/lib/creative-canvas/collaboration.test.ts __tests__/app/api/creative-canvas-collaboration-route.test.ts docs/superpowers/plans/2026-06-19-creative-canvas-full-versions.md
git commit -m "feat(canvas): add versions comments and output review APIs"
```

### Task 2: Rich Workspace Controls

**Files:**
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx`
- Test: `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 1 API routes.
- Produces: UI controls for create canvas, node detail editing, output attach, review status, comments, versions, run queue, and export panel.

- [ ] **Step 1: Write failing UI tests**

```ts
it('shows comments, versions, output, review, run, and export panels', async () => {
  render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)
  expect(await screen.findByText('Launch Canvas')).toBeInTheDocument()
  expect(screen.getByText('Versions')).toBeInTheDocument()
  expect(screen.getByText('Comments')).toBeInTheDocument()
  expect(screen.getByText('Output')).toBeInTheDocument()
  expect(screen.getByText('Exports')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run UI test to verify RED**

Run: `npm test -- --runTestsByPath __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

Expected: FAIL until the new panels exist.

- [ ] **Step 3: Implement minimal rich controls**

Add accessible form controls that call the new APIs. Portal mode should render review/comment controls but hide provider-run controls.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --runTestsByPath __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/creative-canvas/CreativeCanvasWorkspace.tsx __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx
git commit -m "feat(canvas): expand creative canvas workspace controls"
```

### Task 3: Multi-Module Draft Export Adapters

**Files:**
- Create: `lib/creative-canvas/exporters/drafts.ts`
- Create: `app/api/v1/creative-canvas/[id]/exports/draft/route.ts`
- Test: `__tests__/lib/creative-canvas/draft-export.test.ts`

**Interfaces:**
- Produces: `buildCreativeCanvasDraftExport(input)` for `social_draft`, `campaign_asset`, `client_document`, `research`, `youtube_studio`, `book_studio`, `workspace_artifact`
- Produces: `assertCanvasOutputCanExport(node, target, orgId)`

- [ ] **Step 1: Write failing adapter tests**

```ts
it('builds safe draft export payloads for every supported target', () => {
  const targets = ['social_draft', 'campaign_asset', 'client_document', 'research', 'youtube_studio', 'book_studio', 'workspace_artifact'] as const
  for (const target of targets) {
    expect(buildCreativeCanvasDraftExport({ canvas, node, target, actor })).toMatchObject({
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'output-1',
      target,
      status: 'drafted',
    })
  }
})
```

- [ ] **Step 2: Run adapter test to verify RED**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/draft-export.test.ts`

Expected: FAIL because the generic draft exporter does not exist.

- [ ] **Step 3: Implement generic draft exporter and route**

Keep existing Social-specific route for compatibility, but route all new targets through a generic draft exporter that writes `creative_canvas_exports` records and returns module-specific draft payload metadata. Do not call downstream publish/share APIs.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --runTestsByPath __tests__/lib/creative-canvas/draft-export.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/creative-canvas/exporters/drafts.ts app/api/v1/creative-canvas __tests__/lib/creative-canvas/draft-export.test.ts
git commit -m "feat(canvas): add multi-module draft exports"
```

### Task 4: Final Verification And Knowledge Base

**Files:**
- Modify: `docs/superpowers/plans/2026-06-19-creative-canvas-full-versions.md`
- Modify external KB files under `/Users/peetstander/Cowork/Cowork/agents/partners/`

- [ ] **Step 1: Run focused Creative Canvas tests**

Run all creative-canvas unit, API, and component tests.

- [ ] **Step 2: Run typecheck and diff check**

Run: `npm run typecheck` and `git diff --check`.

- [ ] **Step 3: Push**

Run: `git push origin development`.

- [ ] **Step 4: Update Partners KB**

Update hot cache, session log, and `wiki/creative-canvas-foundation-2026-06-19.md` with V2+ implementation details.

# Creative Canvas World Class Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring PiB Creative Canvas to a defensible world-class standard for social media, blogs, videos, audio, books, campaigns, documents, and AI-agent-led production, with Higgsfield Canvas parity proven by live evidence rather than aggregate claims.

**Architecture:** Keep the existing Creative Canvas graph, runtime, export, collaboration, and benchmark-proof foundation, but move proof logic into focused helper modules so the large workspace component only coordinates UI state. Certification is a hard gate: every parity category must have current Higgsfield source evidence, current graph binding, structured live behavior evidence, durable provider/export provenance, signed-in viewport proof, and replayable final proof artifacts.

**Tech Stack:** Next.js App Router, React 19, TypeScript, `@xyflow/react`, Firestore Admin SDK, Jest, Testing Library, Vercel Preview deployments, PiB `withAuth` tenant helpers, existing Creative Canvas runtime/provider/export APIs.

## Global Constraints

- Work on `development`; never implement directly on `main`.
- Push completed work to `origin/development`; do not run `vercel --prod` or promote Preview to production.
- No publishing, scheduling, client-visible sharing, ad launch/spend, YouTube publishing, store/book publishing, Drive ACL mutation, secret/config mutation, destructive action, or live backfill without explicit Peet approval.
- Every canvas, node, edge, run, output, export, comment, presence, proof, and certification record must carry `orgId`.
- Every proof record must be bound to the current canvas version, graph signature, node count, and edge count.
- Direct Higgsfield comparison remains mandatory for certification; source URLs must be reachable and source signals must match the current Higgsfield Canvas pages.
- Current Higgsfield source facts checked on 2026-06-21: Canvas includes Image, Video, Audio, Collab, Marketing Studio, Cinema Studio, AI Influencer, Canvas, Apps, one canvas for every workflow, node drop, chained flow, live collaboration, version saving, comments attached to nodes, reusable templates, Soul ID characters, uploaded products, brand references, previous generations, and model signals Kling 3.0, Seedance 2.0, Wan 2.7, Soul 2.0, GPT Image 2.0, Veo 3.1, NB Pro.
- World-class status cannot be claimed until the final certification task passes against a signed-in Vercel Preview and the KB records the exact proof artifacts.

---

## Scope Check

This is a completion plan for one product area, but it spans multiple independent proof/capability subsystems. Each task below is independently testable and commit-sized. Subagent execution should assign one task at a time unless two tasks have disjoint file ownership.

## File Structure

- Create `lib/creative-canvas/parity-proof.ts`: shared certification contracts and validators used by component UI, sanitizers, and tests.
- Create `lib/creative-canvas/collaboration-proof.ts`: structured remote mutation evidence from live collaboration activity, applied drafts, stream snapshots, and graph differences.
- Create `lib/creative-canvas/mobile-proof.ts`: signed-in viewport behavior evidence validator for desktop, tablet, mobile, and mobile panel modes.
- Create `lib/creative-canvas/export-evidence.ts`: durable category-level runtime/export evidence builder for image, video/social, audio, blog/document, and book.
- Modify `lib/creative-canvas/types.ts`: reusable proof/evidence interfaces shared by runtime, exports, and workspace UI.
- Modify `lib/creative-canvas/sanitize.ts`: preserve new proof arrays and structured proof fields.
- Modify `components/creative-canvas/CreativeCanvasWorkspace.tsx`: wire new helper modules into save/capture proof paths, runbook text, and readiness detail UI.
- Modify `app/api/v1/creative-canvas/[id]/presence/events/route.ts`: emit typed collaboration stream events that include graph signatures and operation summaries.
- Modify `lib/creative-canvas/collaboration.ts`: persist typed mutation metadata in presence/draft records.
- Modify `lib/creative-canvas/runtime-proof.ts`: add per-category runtime evidence arrays to the runtime proof output.
- Modify `lib/creative-canvas/exporters/drafts.ts`: require downstream draft/export evidence records for all supported content targets.
- Modify `lib/creative-canvas/orchestration-tasks.ts`: persist project task IDs and agent handoff lineage back onto canvas nodes.
- Create `scripts/creative-canvas-world-class-proof.mjs`: signed-in Preview proof collector for viewport behavior, proof endpoints, protected-route smoke, and certification output.
- Test files:
  - Create `__tests__/lib/creative-canvas/parity-proof.test.ts`
  - Create `__tests__/lib/creative-canvas/collaboration-proof.test.ts`
  - Create `__tests__/lib/creative-canvas/mobile-proof.test.ts`
  - Create `__tests__/lib/creative-canvas/export-evidence.test.ts`
  - Modify `__tests__/lib/creative-canvas/sanitize.test.ts`
  - Modify `__tests__/lib/creative-canvas/runtime-proof.test.ts`
  - Modify `__tests__/lib/creative-canvas/draft-export.test.ts`
  - Modify `__tests__/lib/creative-canvas/orchestration-tasks.test.ts`
  - Modify `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`
  - Modify `__tests__/app/api/creative-canvas-collaboration-route.test.ts`

### Task 0: Branch Preflight And Execution Rails

**Files:**
- Modify: `docs/superpowers/plans/2026-06-21-creative-canvas-world-class-parity.md`

**Interfaces:**
- Consumes: active repo `/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web`
- Produces: clean synced `development` branch before feature work starts.

- [ ] **Step 1: Verify branch and dirtiness**

Run:

```bash
cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"
git status --short --branch
```

Expected:

```text
## development...origin/development
```

- [ ] **Step 2: Sync from origin development**

Run:

```bash
git pull --rebase origin development
git status --short --branch
```

Expected:

```text
Already up to date.
## development...origin/development
```

- [ ] **Step 3: Assign subagent ownership**

Use these ownership boundaries:

```text
Task 1: lib/creative-canvas/parity-proof.ts and __tests__/lib/creative-canvas/parity-proof.test.ts
Task 2: lib/creative-canvas/collaboration-proof.ts, lib/creative-canvas/collaboration.ts, presence event route, collaboration tests
Task 3: lib/creative-canvas/mobile-proof.ts and mobile/workspace tests
Task 4: lib/creative-canvas/export-evidence.ts, runtime-proof.ts, export/runtime tests
Task 5: exporter and orchestration modules only
Task 6: CreativeCanvasWorkspace.tsx integration only after Tasks 1-5 are merged
Task 7: live proof script and Vercel verification
Task 8: KB persistence and final certification record
```

- [ ] **Step 4: Commit plan baseline**

Run:

```bash
git add docs/superpowers/plans/2026-06-21-creative-canvas-world-class-parity.md
git commit -m "docs(canvas): plan world class parity completion"
```

Expected: one docs commit on `development`.

### Task 1: Shared Parity Proof Contracts

**Files:**
- Create: `lib/creative-canvas/parity-proof.ts`
- Create: `__tests__/lib/creative-canvas/parity-proof.test.ts`
- Modify: `lib/creative-canvas/types.ts`

**Interfaces:**
- Produces: `CreativeCanvasCollaborationProofEvidence`
- Produces: `CreativeCanvasMobileViewportEvidence`
- Produces: `CreativeCanvasCategoryEvidence`
- Produces: `CreativeCanvasWorldClassCertification`
- Produces: `requiredCreativeCanvasProofCategories`
- Produces: `hasStructuredCollaborationProof(proof): boolean`
- Produces: `hasStructuredMobileProof(proof): boolean`
- Produces: `hasDurableCategoryEvidence(proof): boolean`
- Produces: `buildWorldClassCertification(input): CreativeCanvasWorldClassCertification`

- [ ] **Step 1: Write failing shared proof tests**

Create `__tests__/lib/creative-canvas/parity-proof.test.ts`:

```ts
import {
  buildWorldClassCertification,
  hasDurableCategoryEvidence,
  hasStructuredCollaborationProof,
  hasStructuredMobileProof,
  requiredCreativeCanvasProofCategories,
} from '@/lib/creative-canvas/parity-proof'

describe('creative canvas parity proof contracts', () => {
  const capturedAt = '2026-06-21T12:00:00.000Z'

  it('requires the five current content categories', () => {
    expect(requiredCreativeCanvasProofCategories.map((item) => item.key)).toEqual([
      'image',
      'video_social',
      'audio',
      'blog_document',
      'book',
    ])
  })

  it('rejects actor-only collaboration evidence', () => {
    expect(hasStructuredCollaborationProof({
      collaborationRemoteActorCount: 1,
      collaborationRemoteEventCount: 1,
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: 'One remote actor joined.',
    })).toBe(false)
  })

  it('accepts typed remote mutation evidence with graph outcome', () => {
    expect(hasStructuredCollaborationProof({
      collaborationRemoteActorCount: 2,
      collaborationRemoteEventCount: 3,
      collaborationRemoteMutationCount: 2,
      collaborationRemoteMutationKindCount: 2,
      collaborationRemoteTouchedNodeCount: 2,
      collaborationRemoteGraphSignature: 'nodes:a,b|edges:a>b',
      collaborationRemoteSource: 'draft_applied',
      collaborationRemoteOutcome: 'remote_changes_adopted',
      collaborationCapturedAt: capturedAt,
      collaborationEvidence: '2 actors; 2 remote mutations; source draft_applied; outcome remote_changes_adopted.',
      collaborationRemoteMutations: [
        { actorUid: 'user-a', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'stream', occurredAt: capturedAt },
        { actorUid: 'agent-maya', actorType: 'agent', operation: 'edge_add', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], source: 'draft_applied', occurredAt: capturedAt },
      ],
    })).toBe(true)
  })

  it('rejects screenshot-only mobile evidence', () => {
    expect(hasStructuredMobileProof({
      mobileViewportProofCount: 4,
      mobileViewportRequiredCount: 4,
      mobileViewportProofCapturedAt: capturedAt,
      mobileViewportEvidence: '4/4 screenshots captured.',
    })).toBe(false)
  })

  it('accepts signed-in mobile behavior evidence for all required viewports', () => {
    expect(hasStructuredMobileProof({
      mobileViewportProofCount: 4,
      mobileViewportRequiredCount: 4,
      mobileViewportProofCapturedAt: capturedAt,
      mobileViewportEvidence: '4/4 viewport behavior proofs captured.',
      mobileViewportBehaviorEvidence: [
        { key: 'desktop', width: 1440, height: 980, screenshotUrl: 'https://proof.example.com/desktop.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector', 'runs'], capturedAt },
        { key: 'tablet', width: 820, height: 1180, screenshotUrl: 'https://proof.example.com/tablet.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector'], capturedAt },
        { key: 'mobile', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'], capturedAt },
        { key: 'mobile_panels', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile-panels.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['inspector', 'runs', 'exports'], capturedAt },
      ],
    })).toBe(true)
  })

  it('requires durable category evidence instead of aggregate runtime counts', () => {
    expect(hasDurableCategoryEvidence({
      runtimeProviderBackedCategoryCount: 5,
      runtimeProviderBackedCompletedCount: 10,
      runtimeProviderEvidenceCapturedAt: capturedAt,
      runtimeProviderEvidence: '5/5 categories passed.',
    })).toBe(false)
  })

  it('returns blocked certification until every world-class gate is green', () => {
    const certification = buildWorldClassCertification({
      benchmarkProofs: [],
      runtimeProof: undefined,
      liveProofArtifacts: [],
      requiredBenchmarkCount: 10,
      capturedAt,
    })
    expect(certification.status).toBe('blocked')
    expect(certification.blockers).toContain('Missing 10 source-backed benchmark proofs.')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx jest __tests__/lib/creative-canvas/parity-proof.test.ts --runInBand
```

Expected: FAIL with module not found for `@/lib/creative-canvas/parity-proof`.

- [ ] **Step 3: Add proof interfaces to `lib/creative-canvas/types.ts`**

Append these exported types near the existing runtime proof types:

```ts
export type CreativeCanvasProofCategoryKey =
  | 'image'
  | 'video_social'
  | 'audio'
  | 'blog_document'
  | 'book'

export type CreativeCanvasRemoteMutationOperation =
  | 'node_add'
  | 'node_move'
  | 'node_configure'
  | 'edge_add'
  | 'edge_remove'
  | 'draft_apply'
  | 'version_restore'

export interface CreativeCanvasRemoteMutationEvidence {
  actorUid: string
  actorType: CreativeCanvasActorType
  operation: CreativeCanvasRemoteMutationOperation
  touchedNodeIds: string[]
  touchedEdgeIds: string[]
  source: 'stream' | 'draft_applied' | 'poll'
  occurredAt: string
}

export interface CreativeCanvasCollaborationProofEvidence {
  collaborationRemoteActorCount?: number
  collaborationRemoteEventCount?: number
  collaborationRemoteMutationCount?: number
  collaborationRemoteMutationKindCount?: number
  collaborationRemoteTouchedNodeCount?: number
  collaborationRemoteGraphSignature?: string
  collaborationRemoteSource?: 'stream' | 'draft_applied' | 'poll'
  collaborationRemoteOutcome?: 'remote_changes_observed' | 'remote_changes_adopted' | 'conflict_detected' | 'version_forked'
  collaborationCapturedAt?: string
  collaborationEvidence?: string
  collaborationRemoteMutations?: CreativeCanvasRemoteMutationEvidence[]
}

export interface CreativeCanvasMobileViewportEvidence {
  key: 'desktop' | 'tablet' | 'mobile' | 'mobile_panels'
  width: number
  height: number
  screenshotUrl: string
  status: number
  contentType: string
  criticalControlsVisible: boolean
  criticalControlsEnabled: boolean
  horizontalOverflow: boolean
  touchSmokePassed: boolean
  pointerSmokePassed: boolean
  panelKeys: string[]
  capturedAt: string
}

export interface CreativeCanvasCategoryEvidence {
  categoryKey: CreativeCanvasProofCategoryKey
  runIds: string[]
  providerJobIds: string[]
  outputUrls: string[]
  artifactIds: string[]
  outputNodeIds: string[]
  exportIds: string[]
  downstreamDraftIds: string[]
  lineageSourceNodeIds: string[]
  providerKeys: CreativeCanvasProviderKey[]
  outputKinds: CreativeCanvasOutputKind[]
  reviewStatuses: CreativeCanvasReviewStatus[]
  completedAt: string
  evidence: string
}

export interface CreativeCanvasWorldClassCertification {
  status: CreativeCanvasProofStatus
  capturedAt: string
  passedGateCount: number
  requiredGateCount: number
  blockers: string[]
  warnings: string[]
  evidence: string[]
}
```

- [ ] **Step 4: Implement `lib/creative-canvas/parity-proof.ts`**

Create:

```ts
import type {
  CreativeCanvasCategoryEvidence,
  CreativeCanvasCollaborationProofEvidence,
  CreativeCanvasMobileViewportEvidence,
  CreativeCanvasProofCategoryKey,
  CreativeCanvasProofStatus,
  CreativeCanvasWorldClassCertification,
} from './types'

export const requiredCreativeCanvasProofCategories: Array<{ key: CreativeCanvasProofCategoryKey; label: string; requiresProviderJobId: boolean }> = [
  { key: 'image', label: 'Image', requiresProviderJobId: true },
  { key: 'video_social', label: 'Video/social', requiresProviderJobId: true },
  { key: 'audio', label: 'Audio', requiresProviderJobId: true },
  { key: 'blog_document', label: 'Blog/document', requiresProviderJobId: false },
  { key: 'book', label: 'Book', requiresProviderJobId: true },
]

const requiredViewportKeys: CreativeCanvasMobileViewportEvidence['key'][] = ['desktop', 'tablet', 'mobile', 'mobile_panels']

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function uniqueCount(values: string[]): number {
  return new Set(values.filter(hasText)).size
}

export function hasStructuredCollaborationProof(proof: CreativeCanvasCollaborationProofEvidence | undefined): boolean {
  if (!proof) return false
  const mutations = Array.isArray(proof.collaborationRemoteMutations) ? proof.collaborationRemoteMutations : []
  const touchedNodeCount = uniqueCount(mutations.flatMap((item) => item.touchedNodeIds))
  const mutationKindCount = uniqueCount(mutations.map((item) => item.operation))
  return Boolean(
    typeof proof.collaborationRemoteActorCount === 'number'
      && proof.collaborationRemoteActorCount > 0
      && typeof proof.collaborationRemoteEventCount === 'number'
      && proof.collaborationRemoteEventCount > 0
      && typeof proof.collaborationRemoteMutationCount === 'number'
      && proof.collaborationRemoteMutationCount > 0
      && typeof proof.collaborationRemoteMutationKindCount === 'number'
      && proof.collaborationRemoteMutationKindCount > 0
      && typeof proof.collaborationRemoteTouchedNodeCount === 'number'
      && proof.collaborationRemoteTouchedNodeCount > 0
      && proof.collaborationRemoteMutationCount <= mutations.length
      && proof.collaborationRemoteMutationKindCount <= mutationKindCount
      && proof.collaborationRemoteTouchedNodeCount <= touchedNodeCount
      && hasText(proof.collaborationRemoteGraphSignature)
      && hasText(proof.collaborationRemoteSource)
      && proof.collaborationRemoteOutcome !== 'remote_changes_observed'
      && hasText(proof.collaborationRemoteOutcome)
      && hasText(proof.collaborationCapturedAt)
      && hasText(proof.collaborationEvidence),
  )
}

export function hasStructuredMobileProof(proof: {
  mobileViewportProofCount?: number
  mobileViewportRequiredCount?: number
  mobileViewportProofCapturedAt?: string
  mobileViewportEvidence?: string
  mobileViewportBehaviorEvidence?: CreativeCanvasMobileViewportEvidence[]
} | undefined): boolean {
  if (!proof) return false
  const evidence = Array.isArray(proof.mobileViewportBehaviorEvidence) ? proof.mobileViewportBehaviorEvidence : []
  const covered = new Set(evidence.map((item) => item.key))
  return Boolean(
    typeof proof.mobileViewportProofCount === 'number'
      && typeof proof.mobileViewportRequiredCount === 'number'
      && proof.mobileViewportRequiredCount >= requiredViewportKeys.length
      && proof.mobileViewportProofCount >= proof.mobileViewportRequiredCount
      && hasText(proof.mobileViewportProofCapturedAt)
      && hasText(proof.mobileViewportEvidence)
      && requiredViewportKeys.every((key) => covered.has(key))
      && evidence.every((item) => (
        item.status >= 200
        && item.status < 400
        && item.contentType.startsWith('image/')
        && item.criticalControlsVisible
        && item.criticalControlsEnabled
        && item.horizontalOverflow === false
        && item.touchSmokePassed
        && item.pointerSmokePassed
        && item.panelKeys.length > 0
        && hasText(item.screenshotUrl)
        && hasText(item.capturedAt)
      )),
  )
}

export function hasDurableCategoryEvidence(proof: {
  runtimeCategoryEvidence?: CreativeCanvasCategoryEvidence[]
  exportCategoryEvidence?: CreativeCanvasCategoryEvidence[]
} | undefined): boolean {
  if (!proof) return false
  const runtime = Array.isArray(proof.runtimeCategoryEvidence) ? proof.runtimeCategoryEvidence : []
  const exports = Array.isArray(proof.exportCategoryEvidence) ? proof.exportCategoryEvidence : []
  return requiredCreativeCanvasProofCategories.every((category) => {
    const runtimeItem = runtime.find((item) => item.categoryKey === category.key)
    const exportItem = exports.find((item) => item.categoryKey === category.key)
    const runtimeProviderOk = !category.requiresProviderJobId || Boolean(runtimeItem?.providerJobIds.length)
    return Boolean(
      runtimeItem
        && exportItem
        && runtimeItem.runIds.length >= 2
        && runtimeItem.outputNodeIds.length > 0
        && runtimeItem.outputKinds.length > 0
        && runtimeProviderOk
        && exportItem.exportIds.length > 0
        && exportItem.downstreamDraftIds.length > 0
        && exportItem.lineageSourceNodeIds.length > 0
        && hasText(runtimeItem.completedAt)
        && hasText(exportItem.completedAt),
    )
  })
}

export function buildWorldClassCertification(input: {
  benchmarkProofs: Array<{ key: string; passed: boolean; evidence?: string }>
  runtimeProof?: { status: CreativeCanvasProofStatus; readyForLiveProof?: boolean }
  liveProofArtifacts: string[]
  requiredBenchmarkCount: number
  capturedAt: string
}): CreativeCanvasWorldClassCertification {
  const blockers: string[] = []
  const warnings: string[] = []
  const passedBenchmarks = input.benchmarkProofs.filter((item) => item.passed)
  if (passedBenchmarks.length < input.requiredBenchmarkCount) {
    blockers.push(`Missing ${input.requiredBenchmarkCount - passedBenchmarks.length} source-backed benchmark proofs.`)
  }
  if (input.runtimeProof?.status !== 'passed' || input.runtimeProof.readyForLiveProof !== true) {
    blockers.push('Runtime proof is not passed and ready for live proof.')
  }
  if (input.liveProofArtifacts.length < 4) {
    blockers.push('Signed-in live proof artifacts are incomplete.')
  }
  const passedGateCount = input.requiredBenchmarkCount - Math.max(0, input.requiredBenchmarkCount - passedBenchmarks.length)
    + (input.runtimeProof?.status === 'passed' && input.runtimeProof.readyForLiveProof ? 1 : 0)
    + Math.min(input.liveProofArtifacts.length, 4)
  const requiredGateCount = input.requiredBenchmarkCount + 5
  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'passed',
    capturedAt: input.capturedAt,
    passedGateCount,
    requiredGateCount,
    blockers,
    warnings,
    evidence: [
      `${passedBenchmarks.length}/${input.requiredBenchmarkCount} benchmark proofs passed.`,
      `${input.liveProofArtifacts.length}/4 live proof artifacts captured.`,
      ...passedBenchmarks.map((item) => item.evidence).filter(hasText),
    ],
  }
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx jest __tests__/lib/creative-canvas/parity-proof.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/creative-canvas/types.ts lib/creative-canvas/parity-proof.ts __tests__/lib/creative-canvas/parity-proof.test.ts
git commit -m "feat(canvas): add world class parity proof contracts"
```

### Task 2: Structured Live Collaboration Mutation Proof

**Files:**
- Create: `lib/creative-canvas/collaboration-proof.ts`
- Modify: `lib/creative-canvas/collaboration.ts`
- Modify: `app/api/v1/creative-canvas/[id]/presence/events/route.ts`
- Modify: `lib/creative-canvas/sanitize.ts`
- Test: `__tests__/lib/creative-canvas/collaboration-proof.test.ts`
- Test: `__tests__/lib/creative-canvas/sanitize.test.ts`
- Test: `__tests__/app/api/creative-canvas-collaboration-route.test.ts`

**Interfaces:**
- Consumes: Task 1 proof contracts.
- Produces: `collectCollaborationMutationProof(input): CreativeCanvasCollaborationProofEvidence`
- Produces: stored proof fields `collaborationRemoteMutationCount`, `collaborationRemoteMutationKindCount`, `collaborationRemoteTouchedNodeCount`, `collaborationRemoteGraphSignature`, `collaborationRemoteSource`, `collaborationRemoteOutcome`, `collaborationRemoteMutations`.

- [ ] **Step 1: Write failing collaboration proof tests**

Create `__tests__/lib/creative-canvas/collaboration-proof.test.ts`:

```ts
import { collectCollaborationMutationProof } from '@/lib/creative-canvas/collaboration-proof'
import { hasStructuredCollaborationProof } from '@/lib/creative-canvas/parity-proof'

describe('collectCollaborationMutationProof', () => {
  const capturedAt = '2026-06-21T12:30:00.000Z'

  it('does not accept remote presence without a typed mutation', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [{ actorUid: 'user-2', actorType: 'user', hasUnsavedGraphChanges: true, graphSignature: 'draft-only' }],
      activity: [],
      latestAppliedDraft: undefined,
      currentGraphSignature: 'current',
      streamConnected: true,
      capturedAt,
    })
    expect(hasStructuredCollaborationProof(proof)).toBe(false)
    expect(proof.collaborationEvidence).toContain('0 typed remote mutations')
  })

  it('does not accept draft availability until the draft is applied or conflict-handled', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [{ actorUid: 'user-2', actorType: 'user', hasUnsavedGraphChanges: true, graphSignature: 'remote-draft' }],
      activity: [{ actorUid: 'user-2', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'poll', occurredAt: capturedAt }],
      latestAppliedDraft: undefined,
      currentGraphSignature: 'current',
      streamConnected: false,
      capturedAt,
    })
    expect(hasStructuredCollaborationProof(proof)).toBe(false)
    expect(proof.collaborationRemoteOutcome).toBe('remote_changes_observed')
  })

  it('accepts an applied remote draft with touched nodes and graph signature', () => {
    const proof = collectCollaborationMutationProof({
      remotePresence: [
        { actorUid: 'user-2', actorType: 'user', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
        { actorUid: 'agent-maya', actorType: 'agent', hasUnsavedGraphChanges: false, graphSignature: 'after-apply' },
      ],
      activity: [
        { actorUid: 'user-2', actorType: 'user', operation: 'node_move', touchedNodeIds: ['node-a'], touchedEdgeIds: [], source: 'stream', occurredAt: capturedAt },
        { actorUid: 'agent-maya', actorType: 'agent', operation: 'edge_add', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], source: 'draft_applied', occurredAt: capturedAt },
      ],
      latestAppliedDraft: { actorUid: 'agent-maya', actorType: 'agent', graphSignature: 'after-apply', touchedNodeIds: ['node-a', 'node-b'], touchedEdgeIds: ['edge-a-b'], appliedAt: capturedAt },
      currentGraphSignature: 'after-apply',
      streamConnected: true,
      capturedAt,
    })
    expect(hasStructuredCollaborationProof(proof)).toBe(true)
    expect(proof.collaborationRemoteMutationKindCount).toBe(2)
    expect(proof.collaborationRemoteTouchedNodeCount).toBe(2)
    expect(proof.collaborationRemoteOutcome).toBe('remote_changes_adopted')
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx jest __tests__/lib/creative-canvas/collaboration-proof.test.ts --runInBand
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `lib/creative-canvas/collaboration-proof.ts`**

Create:

```ts
import type {
  CreativeCanvasActorType,
  CreativeCanvasCollaborationProofEvidence,
  CreativeCanvasRemoteMutationEvidence,
} from './types'

type RemotePresenceInput = {
  actorUid: string
  actorType: CreativeCanvasActorType
  hasUnsavedGraphChanges?: boolean
  graphSignature?: string
}

type AppliedDraftInput = {
  actorUid: string
  actorType: CreativeCanvasActorType
  graphSignature: string
  touchedNodeIds: string[]
  touchedEdgeIds: string[]
  appliedAt: string
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((item) => item.trim().length > 0)))
}

export function collectCollaborationMutationProof(input: {
  remotePresence: RemotePresenceInput[]
  activity: CreativeCanvasRemoteMutationEvidence[]
  latestAppliedDraft?: AppliedDraftInput
  currentGraphSignature: string
  streamConnected: boolean
  capturedAt: string
}): CreativeCanvasCollaborationProofEvidence {
  const typedMutations = input.activity.filter((event) => event.touchedNodeIds.length || event.touchedEdgeIds.length)
  const appliedMutation = input.latestAppliedDraft
    ? {
        actorUid: input.latestAppliedDraft.actorUid,
        actorType: input.latestAppliedDraft.actorType,
        operation: 'draft_apply' as const,
        touchedNodeIds: input.latestAppliedDraft.touchedNodeIds,
        touchedEdgeIds: input.latestAppliedDraft.touchedEdgeIds,
        source: 'draft_applied' as const,
        occurredAt: input.latestAppliedDraft.appliedAt,
      }
    : undefined
  const mutations = appliedMutation ? [...typedMutations, appliedMutation] : typedMutations
  const actorIds = unique([...input.remotePresence.map((item) => item.actorUid), ...mutations.map((item) => item.actorUid)])
  const operationKinds = unique(mutations.map((item) => item.operation))
  const touchedNodeIds = unique(mutations.flatMap((item) => item.touchedNodeIds))
  const source = appliedMutation ? 'draft_applied' : input.streamConnected ? 'stream' : 'poll'
  const outcome = appliedMutation
    ? 'remote_changes_adopted'
    : typedMutations.length
      ? 'remote_changes_observed'
      : 'remote_changes_observed'
  const graphSignature = appliedMutation?.source === 'draft_applied'
    ? input.latestAppliedDraft?.graphSignature
    : input.remotePresence.find((item) => item.graphSignature)?.graphSignature
  return {
    collaborationRemoteActorCount: actorIds.length,
    collaborationRemoteEventCount: input.remotePresence.length + input.activity.length + (appliedMutation ? 1 : 0),
    collaborationRemoteMutationCount: mutations.length,
    collaborationRemoteMutationKindCount: operationKinds.length,
    collaborationRemoteTouchedNodeCount: touchedNodeIds.length,
    collaborationRemoteGraphSignature: graphSignature,
    collaborationRemoteSource: source,
    collaborationRemoteOutcome: outcome,
    collaborationCapturedAt: input.capturedAt,
    collaborationEvidence: `${actorIds.length} remote actors; ${mutations.length} typed remote mutations; ${touchedNodeIds.length} touched nodes; source ${source}; outcome ${outcome}; stream ${input.streamConnected ? 'connected' : 'poll fallback'}.`,
    collaborationRemoteMutations: mutations,
  }
}
```

- [ ] **Step 4: Persist typed remote mutation metadata**

Modify `lib/creative-canvas/collaboration.ts`:

```ts
export async function updateCreativeCanvasPresence(
  canvasId: string,
  orgId: string,
  input: unknown,
  actor: CreativeCanvasActor,
): Promise<CreativeCanvasPresence & { id: string }> {
  const body = asRecord(input)
  const draftGraph = Object.keys(asRecord(body.draftGraph)).length ? sanitizePresenceDraftGraph(body.draftGraph, orgId) : undefined
  const mutation = asRecord(body.mutation)
  const operation = cleanString(mutation.operation)
  const safeMutation = operation
    ? {
        operation,
        touchedNodeIds: Array.isArray(mutation.touchedNodeIds) ? mutation.touchedNodeIds.map(cleanString).filter(Boolean).slice(0, 40) : [],
        touchedEdgeIds: Array.isArray(mutation.touchedEdgeIds) ? mutation.touchedEdgeIds.map(cleanString).filter(Boolean).slice(0, 80) : [],
        occurredAt: cleanString(mutation.occurredAt) ?? new Date().toISOString(),
      }
    : undefined
  const doc = {
    orgId,
    canvasId,
    actorUid: actor.uid,
    actorType: actor.type,
    displayName: cleanString(body.displayName),
    selectedNodeId: cleanString(body.selectedNodeId),
    graphSignature: cleanString(body.graphSignature),
    hasUnsavedGraphChanges: body.hasUnsavedGraphChanges === true,
    nodeCount: typeof body.nodeCount === 'number' ? Math.max(0, Math.round(body.nodeCount)) : undefined,
    edgeCount: typeof body.edgeCount === 'number' ? Math.max(0, Math.round(body.edgeCount)) : undefined,
    draftGraph,
    latestMutation: safeMutation,
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  }
  await adminDb.collection(CREATIVE_CANVAS_PRESENCE_COLLECTION).doc(`${orgId}_${canvasId}_${actor.uid}`).set(doc, { merge: true })
  return serializePresence(`${orgId}_${canvasId}_${actor.uid}`, doc)
}
```

Keep existing fields in the actual function and merge the new `latestMutation` block into the current document shape.

- [ ] **Step 5: Emit operation metadata in the SSE stream**

Modify `app/api/v1/creative-canvas/[id]/presence/events/route.ts` inside `emitSnapshot()`:

```ts
controller.enqueue(encodeSseEvent('collaboration', {
  canvas,
  presence,
  mutations: presence
    .map((item) => ({
      actorUid: item.actorUid,
      actorType: item.actorType,
      operation: (item as { latestMutation?: { operation?: string } }).latestMutation?.operation,
      touchedNodeIds: (item as { latestMutation?: { touchedNodeIds?: string[] } }).latestMutation?.touchedNodeIds ?? [],
      touchedEdgeIds: (item as { latestMutation?: { touchedEdgeIds?: string[] } }).latestMutation?.touchedEdgeIds ?? [],
      source: 'stream',
      occurredAt: (item as { latestMutation?: { occurredAt?: string } }).latestMutation?.occurredAt,
    }))
    .filter((item) => item.operation && item.occurredAt),
  emittedAtMs: Date.now(),
}))
```

- [ ] **Step 6: Preserve new fields in sanitizer**

Modify `lib/creative-canvas/sanitize.ts` so each benchmark proof record preserves:

```ts
collaborationRemoteMutationCount
collaborationRemoteMutationKindCount
collaborationRemoteTouchedNodeCount
collaborationRemoteGraphSignature
collaborationRemoteSource
collaborationRemoteOutcome
collaborationRemoteMutations
```

Use number rounding for counts, `cleanString(...).slice(0, 160)` for string fields, and cap `collaborationRemoteMutations` to 25 items with `touchedNodeIds` capped at 40 and `touchedEdgeIds` capped at 80.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npx jest __tests__/lib/creative-canvas/collaboration-proof.test.ts __tests__/lib/creative-canvas/sanitize.test.ts __tests__/app/api/creative-canvas-collaboration-route.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/creative-canvas/collaboration-proof.ts lib/creative-canvas/collaboration.ts lib/creative-canvas/sanitize.ts 'app/api/v1/creative-canvas/[id]/presence/events/route.ts' __tests__/lib/creative-canvas/collaboration-proof.test.ts __tests__/lib/creative-canvas/sanitize.test.ts __tests__/app/api/creative-canvas-collaboration-route.test.ts
git commit -m "feat(canvas): require structured collaboration mutation proof"
```

### Task 3: Signed-In Mobile Behavior Proof

**Files:**
- Create: `lib/creative-canvas/mobile-proof.ts`
- Test: `__tests__/lib/creative-canvas/mobile-proof.test.ts`
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx`
- Test: `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`
- Modify: `lib/creative-canvas/sanitize.ts`
- Test: `__tests__/lib/creative-canvas/sanitize.test.ts`

**Interfaces:**
- Consumes: Task 1 mobile evidence contracts.
- Produces: `buildMobileViewportBehaviorProof(input)`
- Produces: `mobileViewportBehaviorEvidence` saved into benchmark proof records.

- [ ] **Step 1: Write failing mobile proof tests**

Create `__tests__/lib/creative-canvas/mobile-proof.test.ts`:

```ts
import { buildMobileViewportBehaviorProof } from '@/lib/creative-canvas/mobile-proof'
import { hasStructuredMobileProof } from '@/lib/creative-canvas/parity-proof'

describe('buildMobileViewportBehaviorProof', () => {
  const capturedAt = '2026-06-21T13:00:00.000Z'

  it('blocks when any viewport has horizontal overflow', () => {
    const proof = buildMobileViewportBehaviorProof({
      capturedAt,
      viewports: [
        { key: 'desktop', width: 1440, height: 980, screenshotUrl: 'https://proof.example.com/desktop.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'tablet', width: 820, height: 1180, screenshotUrl: 'https://proof.example.com/tablet.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: true, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'mobile', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'mobile_panels', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile-panels.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['inspector'] },
      ],
    })
    expect(hasStructuredMobileProof(proof)).toBe(false)
    expect(proof.mobileViewportEvidence).toContain('tablet overflow')
  })

  it('passes with all four signed-in viewport behaviors', () => {
    const proof = buildMobileViewportBehaviorProof({
      capturedAt,
      viewports: [
        { key: 'desktop', width: 1440, height: 980, screenshotUrl: 'https://proof.example.com/desktop.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector', 'runs'] },
        { key: 'tablet', width: 820, height: 1180, screenshotUrl: 'https://proof.example.com/tablet.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph', 'inspector'] },
        { key: 'mobile', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['graph'] },
        { key: 'mobile_panels', width: 390, height: 844, screenshotUrl: 'https://proof.example.com/mobile-panels.png', status: 200, contentType: 'image/png', criticalControlsVisible: true, criticalControlsEnabled: true, horizontalOverflow: false, touchSmokePassed: true, pointerSmokePassed: true, panelKeys: ['inspector', 'runs', 'exports'] },
      ],
    })
    expect(hasStructuredMobileProof(proof)).toBe(true)
    expect(proof.mobileViewportProofCount).toBe(4)
    expect(proof.mobileViewportEvidence).toContain('4/4 signed-in viewport behavior proofs')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx jest __tests__/lib/creative-canvas/mobile-proof.test.ts --runInBand
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `lib/creative-canvas/mobile-proof.ts`**

Create:

```ts
import type { CreativeCanvasMobileViewportEvidence } from './types'

type ViewportInput = Omit<CreativeCanvasMobileViewportEvidence, 'capturedAt'>

const requiredKeys: CreativeCanvasMobileViewportEvidence['key'][] = ['desktop', 'tablet', 'mobile', 'mobile_panels']

export function buildMobileViewportBehaviorProof(input: {
  viewports: ViewportInput[]
  capturedAt: string
}) {
  const evidence: CreativeCanvasMobileViewportEvidence[] = input.viewports.map((item) => ({
    ...item,
    capturedAt: input.capturedAt,
  }))
  const covered = new Set(evidence.map((item) => item.key))
  const missing = requiredKeys.filter((key) => !covered.has(key))
  const failing = evidence.filter((item) => (
    item.status < 200
    || item.status >= 400
    || !item.contentType.startsWith('image/')
    || !item.criticalControlsVisible
    || !item.criticalControlsEnabled
    || item.horizontalOverflow
    || !item.touchSmokePassed
    || !item.pointerSmokePassed
    || item.panelKeys.length === 0
  ))
  const failureText = [
    ...missing.map((key) => `${key} missing`),
    ...failing.map((item) => `${item.key}${item.horizontalOverflow ? ' overflow' : ' behavior incomplete'}`),
  ]
  return {
    mobileViewportProofCount: evidence.length,
    mobileViewportRequiredCount: requiredKeys.length,
    mobileViewportProofCapturedAt: input.capturedAt,
    mobileViewportEvidence: failureText.length
      ? `${evidence.length}/${requiredKeys.length} signed-in viewport behavior proofs captured; ${failureText.join(', ')}.`
      : `${evidence.length}/${requiredKeys.length} signed-in viewport behavior proofs captured with controls visible, enabled, touch/pointer smoke passed, and no horizontal overflow.`,
    mobileViewportBehaviorEvidence: evidence,
  }
}
```

- [ ] **Step 4: Wire component capture to structured behavior evidence**

In `components/creative-canvas/CreativeCanvasWorkspace.tsx`, replace mobile benchmark proof creation with `buildMobileViewportBehaviorProof`. The saved proof must include `mobileViewportBehaviorEvidence`, and `hasMobileViewportBenchmarkProof` must call `hasStructuredMobileProof`.

Use this import:

```ts
import { buildMobileViewportBehaviorProof } from '@/lib/creative-canvas/mobile-proof'
import { hasStructuredMobileProof } from '@/lib/creative-canvas/parity-proof'
```

Use this validator body:

```ts
function hasMobileViewportBenchmarkProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return hasStructuredMobileProof(proof)
}
```

- [ ] **Step 5: Preserve mobile evidence arrays in sanitizer**

Modify `lib/creative-canvas/sanitize.ts` to preserve `mobileViewportBehaviorEvidence` as an array capped at 8 records. Each record must keep `key`, `width`, `height`, `screenshotUrl`, `status`, `contentType`, `criticalControlsVisible`, `criticalControlsEnabled`, `horizontalOverflow`, `touchSmokePassed`, `pointerSmokePassed`, `panelKeys`, and `capturedAt`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npx jest __tests__/lib/creative-canvas/mobile-proof.test.ts __tests__/lib/creative-canvas/sanitize.test.ts __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/creative-canvas/mobile-proof.ts lib/creative-canvas/sanitize.ts components/creative-canvas/CreativeCanvasWorkspace.tsx __tests__/lib/creative-canvas/mobile-proof.test.ts __tests__/lib/creative-canvas/sanitize.test.ts __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx
git commit -m "feat(canvas): require signed-in mobile behavior proof"
```

### Task 4: Durable Runtime And Export Category Evidence

**Files:**
- Create: `lib/creative-canvas/export-evidence.ts`
- Test: `__tests__/lib/creative-canvas/export-evidence.test.ts`
- Modify: `lib/creative-canvas/runtime-proof.ts`
- Test: `__tests__/lib/creative-canvas/runtime-proof.test.ts`
- Modify: `lib/creative-canvas/sanitize.ts`
- Test: `__tests__/lib/creative-canvas/sanitize.test.ts`

**Interfaces:**
- Consumes: Task 1 category contracts.
- Produces: `buildCreativeCanvasCategoryEvidence(input): CreativeCanvasCategoryEvidence[]`
- Produces: `runtimeCategoryEvidence` and `exportCategoryEvidence`.

- [ ] **Step 1: Write failing export evidence tests**

Create `__tests__/lib/creative-canvas/export-evidence.test.ts`:

```ts
import { buildCreativeCanvasCategoryEvidence } from '@/lib/creative-canvas/export-evidence'

describe('buildCreativeCanvasCategoryEvidence', () => {
  it('builds durable evidence for all five categories', () => {
    const completedAt = '2026-06-21T14:00:00.000Z'
    const evidence = buildCreativeCanvasCategoryEvidence({
      completedAt,
      runs: [
        run('image-1', 'image', 'higgsfield-job-image-1', 'output-image', 'https://cdn.example.com/image-1.png'),
        run('image-2', 'campaign_asset', 'higgsfield-job-image-2', 'output-image', 'https://cdn.example.com/image-2.png'),
        run('video-1', 'video', 'higgsfield-job-video-1', 'output-video', 'https://cdn.example.com/video-1.mp4'),
        run('video-2', 'social_post_draft', 'higgsfield-job-video-2', 'output-video', 'https://cdn.example.com/video-2.mp4'),
        run('audio-1', 'audio', 'higgsfield-job-audio-1', 'output-audio', 'https://cdn.example.com/audio-1.mp3'),
        run('audio-2', 'audio', 'higgsfield-job-audio-2', 'output-audio', 'https://cdn.example.com/audio-2.mp3'),
        run('blog-1', 'blog_draft', undefined, 'output-blog', undefined, 'Blog draft'),
        run('blog-2', 'document_block', undefined, 'output-blog', undefined, 'Document block'),
        run('book-1', 'book_artifact', 'higgsfield-job-book-1', 'output-book', 'https://cdn.example.com/book-1.pdf'),
        run('book-2', 'book_artifact', 'higgsfield-job-book-2', 'output-book', 'https://cdn.example.com/book-2.pdf'),
      ],
      exports: [
        draftExport('export-image', 'image', 'output-image', 'draft-image', ['source-product']),
        draftExport('export-video', 'video_social', 'output-video', 'draft-video', ['source-video']),
        draftExport('export-audio', 'audio', 'output-audio', 'draft-audio', ['source-audio']),
        draftExport('export-blog', 'blog_document', 'output-blog', 'draft-blog', ['source-research']),
        draftExport('export-book', 'book', 'output-book', 'draft-book', ['source-book']),
      ],
    })
    expect(evidence.runtimeCategoryEvidence).toHaveLength(5)
    expect(evidence.exportCategoryEvidence).toHaveLength(5)
    expect(evidence.runtimeCategoryEvidence.find((item) => item.categoryKey === 'audio')?.providerJobIds).toHaveLength(2)
    expect(evidence.exportCategoryEvidence.find((item) => item.categoryKey === 'book')?.downstreamDraftIds).toEqual(['draft-book'])
  })
})

function run(id: string, outputKind: string, providerJobId: string | undefined, outputNodeId: string, url?: string, textPreview?: string) {
  return {
    id,
    status: 'completed',
    input: { outputKind },
    providerKey: 'higgsfield',
    provenance: providerJobId ? { providerJobId } : {},
    output: { nodeId: outputNodeId, url, textPreview, rawProviderJobId: providerJobId },
  }
}

function draftExport(id: string, categoryKey: string, outputNodeId: string, downstreamDraftId: string, sourceNodeIds: string[]) {
  return {
    id,
    categoryKey,
    outputNodeId,
    downstreamDraftId,
    sourceNodeIds,
    target: categoryKey,
    status: 'drafted',
    createdAt: '2026-06-21T14:00:00.000Z',
  }
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx jest __tests__/lib/creative-canvas/export-evidence.test.ts --runInBand
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement `lib/creative-canvas/export-evidence.ts`**

Create a builder that maps:

```ts
image -> image, campaign_asset
video_social -> video, social_post_draft, youtube_render
audio -> audio
blog_document -> blog_draft, document_block, copy, caption
book -> book_artifact
```

Each runtime category must include two completed runs, output node IDs, provider job IDs for media categories, output URLs or artifact IDs or text previews, provider keys, output kinds, review statuses when available, `completedAt`, and a readable evidence string.

Each export category must include at least one export record, downstream draft ID, output node ID, lineage source node IDs, `completedAt`, and a readable evidence string.

- [ ] **Step 4: Add runtime proof arrays**

Modify `lib/creative-canvas/runtime-proof.ts`:

```ts
import { buildCreativeCanvasCategoryEvidence } from './export-evidence'
```

Inside `buildCreativeCanvasRuntimeProof`, build durable category evidence from runs and export records. If export records are not available to the function, add an optional `exports?: CreativeCanvasExportRecord[]` input parameter and pass an empty array at existing call sites until Task 5 supplies real export records.

Return:

```ts
runtimeCategoryEvidence: categoryEvidence.runtimeCategoryEvidence,
exportCategoryEvidence: categoryEvidence.exportCategoryEvidence,
```

- [ ] **Step 5: Tighten benchmark validators**

In `components/creative-canvas/CreativeCanvasWorkspace.tsx`, update `hasExportArtifactBackedProof` and `hasRuntimeSnapshotProof` so aggregate counts are insufficient unless `hasDurableCategoryEvidence(proof)` passes.

- [ ] **Step 6: Preserve evidence arrays in sanitizer**

Modify `lib/creative-canvas/sanitize.ts` to preserve `runtimeCategoryEvidence` and `exportCategoryEvidence`, each capped at 10 records. Preserve `categoryKey`, `runIds`, `providerJobIds`, `outputUrls`, `artifactIds`, `outputNodeIds`, `exportIds`, `downstreamDraftIds`, `lineageSourceNodeIds`, `providerKeys`, `outputKinds`, `reviewStatuses`, `completedAt`, and `evidence`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npx jest __tests__/lib/creative-canvas/export-evidence.test.ts __tests__/lib/creative-canvas/runtime-proof.test.ts __tests__/lib/creative-canvas/sanitize.test.ts __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/creative-canvas/export-evidence.ts lib/creative-canvas/runtime-proof.ts lib/creative-canvas/sanitize.ts components/creative-canvas/CreativeCanvasWorkspace.tsx __tests__/lib/creative-canvas/export-evidence.test.ts __tests__/lib/creative-canvas/runtime-proof.test.ts __tests__/lib/creative-canvas/sanitize.test.ts __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx
git commit -m "feat(canvas): require durable runtime and export evidence"
```

### Task 5: Real Downstream Draft Adapters And Agent Lineage

**Files:**
- Modify: `lib/creative-canvas/exporters/drafts.ts`
- Test: `__tests__/lib/creative-canvas/draft-export.test.ts`
- Modify: `app/api/v1/creative-canvas/[id]/exports/draft/route.ts`
- Modify: `app/api/v1/creative-canvas/[id]/exports/package/route.ts`
- Modify: `lib/creative-canvas/orchestration-tasks.ts`
- Test: `__tests__/lib/creative-canvas/orchestration-tasks.test.ts`

**Interfaces:**
- Consumes: Task 4 `CreativeCanvasCategoryEvidence`.
- Produces: `CreativeCanvasExportRecord` with `categoryKey`, `downstreamDraftId`, `lineageSourceNodeIds`, `outputNodeId`, `target`, `status`, and `createdAt`.
- Produces: project task IDs persisted back onto node data under `data.agentTaskIds`.

- [ ] **Step 1: Write failing draft export test**

In `__tests__/lib/creative-canvas/draft-export.test.ts`, add:

```ts
it('requires category lineage for every world-class export target', () => {
  const targets = [
    ['social_draft', 'video_social'],
    ['campaign_asset', 'image'],
    ['client_document', 'blog_document'],
    ['blog_post', 'blog_document'],
    ['youtube_studio', 'video_social'],
    ['book_studio', 'book'],
    ['workspace_artifact', 'image'],
  ] as const
  for (const [target, categoryKey] of targets) {
    const exportRecord = buildCreativeCanvasDraftExport({
      canvas,
      node: outputNode,
      target,
      actor,
      lineageSourceNodeIds: ['source-1', 'source-2'],
      downstreamDraftId: `${target}-draft-1`,
    })
    expect(exportRecord).toMatchObject({
      orgId: canvas.orgId,
      canvasId: canvas.id,
      nodeId: outputNode.id,
      target,
      categoryKey,
      downstreamDraftId: `${target}-draft-1`,
      lineageSourceNodeIds: ['source-1', 'source-2'],
      status: 'drafted',
    })
  }
})
```

- [ ] **Step 2: Write failing orchestration lineage test**

In `__tests__/lib/creative-canvas/orchestration-tasks.test.ts`, add:

```ts
it('returns node task lineage for project-linked agent handoffs', async () => {
  const result = await createCreativeCanvasOrchestrationTasks(canvasWithProject, { projectId: 'project-1' }, { uid: 'pip', type: 'agent' })
  expect(result.createdTasks[0]).toMatchObject({
    nodeId: expect.any(String),
    agentId: expect.any(String),
    title: expect.stringContaining('Creative Canvas:'),
  })
  expect(result.nodeTaskLineage[0]).toMatchObject({
    nodeId: result.createdTasks[0].nodeId,
    taskId: result.createdTasks[0].id,
    projectId: 'project-1',
  })
})
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npx jest __tests__/lib/creative-canvas/draft-export.test.ts __tests__/lib/creative-canvas/orchestration-tasks.test.ts --runInBand
```

Expected: FAIL because `blog_post`, category lineage, downstream draft IDs, or `nodeTaskLineage` are not complete.

- [ ] **Step 4: Implement export category mapping**

Modify `lib/creative-canvas/exporters/drafts.ts`:

```ts
const targetCategoryMap = {
  social_draft: 'video_social',
  campaign_asset: 'image',
  client_document: 'blog_document',
  blog_post: 'blog_document',
  youtube_studio: 'video_social',
  book_studio: 'book',
  workspace_artifact: 'image',
} as const
```

The export builder must reject missing `lineageSourceNodeIds`, missing `downstreamDraftId`, output nodes without review pass/warning status, and unsafe URLs.

- [ ] **Step 5: Update export routes**

Modify draft and package export routes so successful draft creation stores:

```ts
categoryKey
lineageSourceNodeIds
downstreamDraftId
outputNodeId
outputKind
reviewStatus
createdBy
createdByType
createdAt
```

The route must return the stored export record, not only a synthetic response.

- [ ] **Step 6: Return agent lineage**

Modify `createCreativeCanvasOrchestrationTasks` return type:

```ts
nodeTaskLineage: Array<{ nodeId: string; taskId: string; projectId: string; agentId: string }>
```

Push an item into `nodeTaskLineage` each time a task is created, and include the same IDs in `createdTasks`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npx jest __tests__/lib/creative-canvas/draft-export.test.ts __tests__/lib/creative-canvas/orchestration-tasks.test.ts __tests__/app/api/creative-canvas-draft-export-route.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/creative-canvas/exporters/drafts.ts lib/creative-canvas/orchestration-tasks.ts 'app/api/v1/creative-canvas/[id]/exports/draft/route.ts' 'app/api/v1/creative-canvas/[id]/exports/package/route.ts' __tests__/lib/creative-canvas/draft-export.test.ts __tests__/lib/creative-canvas/orchestration-tasks.test.ts __tests__/app/api/creative-canvas-draft-export-route.test.ts
git commit -m "feat(canvas): persist downstream export and agent lineage"
```

### Task 6: Workspace Certification UI Integration

**Files:**
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx`
- Test: `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

**Interfaces:**
- Consumes: Tasks 1-5 helper modules.
- Produces: UI readiness copy that cannot report world-class status unless all structured proof gates pass.

- [ ] **Step 1: Write failing workspace tests**

In `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`, add:

```ts
it('does not call the canvas world-class when structured proof arrays are missing', async () => {
  mockCreativeCanvasApi({
    benchmarkProofs: [{
      key: 'production_reliability',
      proofUrl: 'https://proof.example.com/reliability.mp4',
      notes: 'Aggregate counts only.',
      runtimeProviderBackedCategoryCount: 5,
      runtimeProviderBackedCompletedCount: 10,
      runtimeProviderEvidenceCapturedAt: '2026-06-21T14:30:00.000Z',
      runtimeProviderEvidence: '5/5 categories passed.',
    }],
  })
  render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)
  const benchmarkProof = await screen.findByLabelText(/direct higgsfield benchmark proof/i)
  expect(benchmarkProof).toHaveTextContent('Needs durable per-category runtime and export evidence before reliability proof can pass.')
  expect(screen.queryByText(/world-class certification passed/i)).not.toBeInTheDocument()
})

it('shows certification passed only when all hard proof gates pass', async () => {
  mockCreativeCanvasApi(worldClassCanvasFixture())
  render(<CreativeCanvasWorkspace mode="admin" orgId="org-1" />)
  expect(await screen.findByText(/World-class certification passed/i)).toBeInTheDocument()
  expect(screen.getByText(/Collaboration mutation proof/i)).toBeInTheDocument()
  expect(screen.getByText(/Signed-in mobile behavior proof/i)).toBeInTheDocument()
  expect(screen.getByText(/Durable export and runtime evidence/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx jest __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx --runInBand
```

Expected: FAIL until UI integrates the new hard validators.

- [ ] **Step 3: Integrate helper validators**

Modify `components/creative-canvas/CreativeCanvasWorkspace.tsx`:

```ts
import {
  buildWorldClassCertification,
  hasDurableCategoryEvidence,
  hasStructuredCollaborationProof,
  hasStructuredMobileProof,
} from '@/lib/creative-canvas/parity-proof'
```

Replace local proof validators with helper calls:

```ts
function hasCollaborationSessionProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return hasStructuredCollaborationProof(proof)
}

function hasMobileViewportBenchmarkProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return hasStructuredMobileProof(proof)
}

function hasExportArtifactBackedProof(proof: CreativeCanvasBenchmarkProofRecord | undefined): boolean {
  return hasDurableCategoryEvidence(proof)
}
```

Use `buildWorldClassCertification` to render one status block. The passed copy must be exactly:

```text
World-class certification passed
```

The blocked copy must be exactly:

```text
World-class certification blocked
```

- [ ] **Step 4: Add missing warning copy**

Add these detail strings in the benchmark proof list:

```text
Needs structured remote mutation evidence before collaboration proof can pass.
Needs signed-in behavior evidence for desktop, tablet, mobile, and mobile panels before mobile proof can pass.
Needs durable per-category runtime and export evidence before reliability proof can pass.
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx jest __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add components/creative-canvas/CreativeCanvasWorkspace.tsx __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx
git commit -m "feat(canvas): integrate world class certification UI"
```

### Task 7: Signed-In Preview Proof Automation

**Files:**
- Create: `scripts/creative-canvas-world-class-proof.mjs`
- Modify: `package.json`
- Test: `__tests__/scripts/creative-canvas-world-class-proof.test.ts`

**Interfaces:**
- Consumes: a Vercel Preview URL and a signed-in browser/session context supplied by the operator.
- Produces: JSON proof output under `artifacts/creative-canvas/world-class-proof-YYYY-MM-DDTHH-MM-SS-msZ.json`.

- [ ] **Step 1: Add script test**

Create `__tests__/scripts/creative-canvas-world-class-proof.test.ts`:

```ts
import { spawnSync } from 'child_process'
import path from 'path'

describe('creative-canvas-world-class-proof script', () => {
  it('prints usage when preview URL is missing', () => {
    const result = spawnSync('node', [path.join(process.cwd(), 'scripts/creative-canvas-world-class-proof.mjs')], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: node scripts/creative-canvas-world-class-proof.mjs --preview-url PREVIEW_URL')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx jest __tests__/scripts/creative-canvas-world-class-proof.test.ts --runInBand
```

Expected: FAIL with missing script.

- [ ] **Step 3: Create proof script**

Create `scripts/creative-canvas-world-class-proof.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const previewUrl = arg('--preview-url')
const proofUrl = arg('--proof-url') || `${previewUrl || ''}/portal/creative-canvas`

if (!previewUrl) {
  console.error('Usage: node scripts/creative-canvas-world-class-proof.mjs --preview-url PREVIEW_URL [--proof-url PROOF_URL]')
  process.exit(1)
}

const checkedAt = new Date().toISOString()
const response = await fetch(proofUrl, { redirect: 'manual' })
const protectedRouteOk = response.status === 200 || response.status === 401 || response.status === 307 || response.status === 308

const output = {
  previewUrl,
  proofUrl,
  checkedAt,
  protectedRoute: {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    ok: protectedRouteOk,
  },
  requiredManualSignedInArtifacts: [
    'desktop viewport behavior screenshot and interaction JSON',
    'tablet viewport behavior screenshot and interaction JSON',
    'mobile viewport behavior screenshot and interaction JSON',
    'mobile panel viewport behavior screenshot and interaction JSON',
    'two-user collaboration mutation video or event JSON',
    'runtime/export category evidence JSON',
  ],
}

const dir = path.join(process.cwd(), 'artifacts', 'creative-canvas')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, `world-class-proof-${checkedAt.replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`)
console.log(file)
if (!protectedRouteOk) process.exit(2)
```

- [ ] **Step 4: Add package script**

Modify `package.json`:

```json
"proof:creative-canvas": "node scripts/creative-canvas-world-class-proof.mjs"
```

Keep the JSON syntax valid by adding a comma to the previous script entry.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx jest __tests__/scripts/creative-canvas-world-class-proof.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add scripts/creative-canvas-world-class-proof.mjs package.json __tests__/scripts/creative-canvas-world-class-proof.test.ts
git commit -m "chore(canvas): add world class proof collector"
```

### Task 8: Full Verification, Preview Deploy, And KB Certification Record

**Files:**
- Modify: `/Users/peetstander/Cowork/Cowork/agents/partners/wiki/hot.md`
- Modify: `/Users/peetstander/Cowork/Cowork/agents/partners/index.md`
- Modify: `/Users/peetstander/Cowork/Cowork/agents/partners/logs/2026-06-21.md`
- Create: `/Users/peetstander/Cowork/Cowork/agents/partners/wiki/creative-canvas-world-class-parity-certification-2026-06-21.md`

**Interfaces:**
- Consumes: all previous task commits.
- Produces: pushed development branch, Vercel Preview status, protected route smoke result, and durable KB record.

- [ ] **Step 1: Run focused Creative Canvas tests**

Run:

```bash
npx jest __tests__/components/creative-canvas __tests__/lib/creative-canvas __tests__/app/api/creative-canvas-route.test.ts __tests__/app/api/creative-canvas-collaboration-route.test.ts __tests__/app/api/creative-canvas-draft-export-route.test.ts __tests__/app/api/creative-canvas-runtime-proof-route.test.ts __tests__/app/api/creative-canvas-proof-batch-route.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run typecheck, lint, and diff check**

Run:

```bash
npm run typecheck
npx eslint components/creative-canvas/CreativeCanvasWorkspace.tsx lib/creative-canvas/parity-proof.ts lib/creative-canvas/collaboration-proof.ts lib/creative-canvas/mobile-proof.ts lib/creative-canvas/export-evidence.ts --max-warnings=0
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Commit final implementation if needed**

Run:

```bash
git status --short
git add -A
git commit -m "feat(canvas): complete world class parity certification gates"
```

Expected: commit only if Step 1 or Step 2 required final edits.

- [ ] **Step 4: Push development**

Run:

```bash
git push origin development
```

Expected: push succeeds.

- [ ] **Step 5: Trigger Vercel Preview build**

Run:

```bash
git commit --allow-empty -m "chore(canvas): trigger world class proof preview [vercel-build]"
git push origin development
```

Expected: a new Vercel Preview deployment starts for `development`.

- [ ] **Step 6: Inspect Vercel Preview**

Run:

```bash
PREVIEW_URL="paste-the-ready-preview-url-from-vercel"
vercel inspect "$PREVIEW_URL" --wait
```

Expected: deployment state `READY`.

- [ ] **Step 7: Smoke protected canvas route**

Run:

```bash
PREVIEW_URL="paste-the-ready-preview-url-from-vercel"
curl -I "$PREVIEW_URL/portal/creative-canvas"
```

Expected: `HTTP/2 401`, `HTTP/2 307`, `HTTP/2 308`, or `HTTP/2 200` depending on Preview auth/session state. Treat `5xx` as a blocker.

- [ ] **Step 8: Collect final proof artifact**

Run:

```bash
PREVIEW_URL="paste-the-ready-preview-url-from-vercel"
npm run proof:creative-canvas -- --preview-url "$PREVIEW_URL"
```

Expected: the script prints a JSON file path under `artifacts/creative-canvas/`.

- [ ] **Step 9: Write KB article**

Create `/Users/peetstander/Cowork/Cowork/agents/partners/wiki/creative-canvas-world-class-parity-certification-2026-06-21.md` with this structure:

```markdown
# Creative Canvas World-Class Parity Certification (2026-06-21)

## Status

Not certified until every listed proof artifact is present and the live preview smoke is green.

## Implemented Gates

- Structured collaboration mutation proof.
- Signed-in mobile behavior proof.
- Durable runtime and export category evidence.
- Downstream draft and agent lineage evidence.
- Workspace certification UI gate.
- Preview proof collector.

## Verification

- Focused Creative Canvas Jest: PASS after `npx jest ... --runInBand`, or FAIL with the failing test name and error summary.
- Typecheck: PASS after `npm run typecheck`, or FAIL with the first TypeScript diagnostic.
- Targeted ESLint: PASS after targeted `npx eslint`, or FAIL with the first lint rule and file.
- Diff check: PASS after `git diff --check`, or FAIL with the exact whitespace error.
- Push: write the pushed commit SHA from `git rev-parse --short HEAD`.
- Vercel Preview: write the Preview URL and deployment state from `vercel inspect`.
- Protected route smoke: write the HTTP status from `curl -I "$PREVIEW_URL/portal/creative-canvas"`.
- Proof artifact: write the absolute path printed by `npm run proof:creative-canvas`.

## Remaining Blockers

- Write `None` only when every live signed-in artifact is captured and inspected; otherwise list each missing artifact on its own bullet.
```

Replace each angle-bracket value with the actual command result before committing the KB update.

- [ ] **Step 10: Update hot cache**

Overwrite `/Users/peetstander/Cowork/Cowork/agents/partners/wiki/hot.md` under 500 words with the current Creative Canvas certification status, newest commits, preview URL, test results, and blockers.

- [ ] **Step 11: Update index and session log**

Add one index entry pointing to the KB article and append a dated session log entry to `/Users/peetstander/Cowork/Cowork/agents/partners/logs/2026-06-21.md`.

- [ ] **Step 12: Commit KB updates**

Run:

```bash
cd "/Users/peetstander/Cowork/Cowork/agents/partners"
git status --short --branch
git add wiki/hot.md index.md logs/2026-06-21.md wiki/creative-canvas-world-class-parity-certification-2026-06-21.md
git commit -m "docs(canvas): record world class parity certification status"
```

Expected: one KB commit. Do not force push the KB repo.

## Self-Review

**Spec coverage:** The plan covers Higgsfield one-canvas workflow, node-based composition, multi-model/category support, collaboration, versions/comments/templates through existing gates, mobile behavior, image/video/audio/blog/book exports, runtime reliability, provider provenance, AI agent task integration, Preview proof, and KB persistence.

**Placeholder scan:** This plan intentionally avoids open-ended implementation placeholders. Each task names exact files, functions, tests, commands, and expected outcomes. Execution-time values use shell variables or explicit instructions to copy command output into the KB.

**Type consistency:** Shared evidence types are defined in Task 1 and consumed by Tasks 2-6 with the same names: `CreativeCanvasCollaborationProofEvidence`, `CreativeCanvasMobileViewportEvidence`, `CreativeCanvasCategoryEvidence`, `CreativeCanvasWorldClassCertification`, `hasStructuredCollaborationProof`, `hasStructuredMobileProof`, and `hasDurableCategoryEvidence`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-creative-canvas-world-class-parity.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

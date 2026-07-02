# Creative Canvas Everyday UX (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canvas management, node manipulation, inline AI editing, and media insertion obvious and pleasant — per the approved spec `docs/superpowers/specs/2026-07-02-creative-canvas-everyday-ux-design.md`.

**Architecture:** All work rides on existing plumbing: `CanvasLanding` + `createBlankCanvas` (management), React Flow `onNodesChange` remove path (delete), `duplicateSelectedNode` (duplicate), `ReferencePicker` + `importSourceItem` (assets), the runs/generate pipeline with `referenceImageUrls` (AI edit). New UI is three small components (`NodeActionBar`, `NodeEditChat`, landing row actions) wired through the existing `nodeActionRefs` indirection so node cards stay presentational.

**Tech Stack:** Next.js 16 App Router, React Flow (@xyflow/react 12), Firestore admin, Jest + Testing Library.

**Verification gates for every task:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --project tsconfig.typecheck.json` and `npx jest __tests__/components/creative-canvas` must pass before commit.

---

### Task 1: Top bar — labeled Canvases button + New button

**Files:**
- Modify: `components/creative-canvas/topbar/CanvasTopBar.tsx`
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` (CanvasTopBar call site ~5332)
- Test: `__tests__/components/creative-canvas/CanvasTopBar.test.tsx` (create)

- [ ] Add `onNewCanvas?: () => void` to `CanvasTopBarProps`. Replace the ⬓ icon-only button with a labeled button (`⬓ Canvases`, keeps `aria-label="All canvases"`), and render a `+ New` button beside it when `onNewCanvas` is set (`aria-label="New canvas"`).
- [ ] Wire at the workspace call site: `onNewCanvas={() => { setShowLanding(false); void createBlankCanvas() }}` and ensure `onHome={() => setShowLanding(true)}` is passed (verify existing).
- [ ] Test: render CanvasTopBar with both handlers, assert buttons by role/name and click-through.
- [ ] Typecheck + jest; commit `feat(creative-canvas): labeled Canvases + New buttons in top bar`.

### Task 2: Landing — rename + delete boards, updatedAt

**Files:**
- Modify: `components/creative-canvas/landing/CanvasLanding.tsx` (extend `boards` item shape: `{ id, title, updatedAt?: string }`, add `onRenameBoard(id, title)`, `onDeleteBoard(id)`)
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` (landing call site ~5304)
- Verify/Add: DELETE handling — `app/api/v1/creative-canvas/[id]/route.ts` (PATCH `{deleted: true}` via existing `updateCreativeCanvas` if no DELETE export)
- Test: `__tests__/components/creative-canvas/CanvasLanding.test.tsx` (extend)

- [ ] Board cards get a `⋯` menu with Rename (inline input, calls `onRenameBoard`) and Delete (confirm via `window.confirm`, calls `onDeleteBoard`).
- [ ] Workspace: `onRenameBoard` → PATCH `/api/v1/creative-canvas/{id}?orgId=` `{ title }`, update `canvases` state. `onDeleteBoard` → PATCH `{ deleted: true }` (or DELETE if route exists), remove from `canvases`, clear `activeCanvasId` if it was open.
- [ ] Tests: rename fires with new title; delete fires after confirm; board shows updatedAt when provided.
- [ ] Typecheck + jest; commit `feat(creative-canvas): rename/delete canvases from landing`.

### Task 3: NodeActionBar on every node card

**Files:**
- Create: `components/creative-canvas/nodes/NodeActionBar.tsx`
- Modify: `components/creative-canvas/nodes/nodeFactory.tsx` (render inside the shared card chrome, top-right, visible on hover/selection)
- Modify: `components/creative-canvas/nodes/CombineNode.tsx` (same bar)
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` — `displayNodes` data gains `onDelete`, `onDuplicate`, `onReplaceContent`, `onEditWithAi`, `downloadUrl`; `nodeActionRefs` gains `delete`, `duplicate` (wraps `duplicateSelectedNode` generalized to take a nodeId), `replaceContent`, `editWithAi`.
- Test: `__tests__/components/creative-canvas/NodeActionBar.test.tsx` (create)

NodeActionBar (presentational):

```tsx
'use client'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'

export interface NodeActionBarProps {
  onDelete?: () => void
  onDuplicate?: () => void
  onEditWithAi?: () => void
  onReplaceContent?: () => void
  downloadUrl?: string
}

const btn: React.CSSProperties = { width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 7, border: `1px solid ${canvasTheme.border}`, background: canvasTheme.surfaceRaised, color: canvasTheme.text, cursor: 'pointer', fontSize: 12 }

export default function NodeActionBar({ onDelete, onDuplicate, onEditWithAi, onReplaceContent, downloadUrl }: NodeActionBarProps) {
  return (
    <div className="node-action-bar" style={{ position: 'absolute', top: -34, right: 0, display: 'flex', gap: 4, zIndex: 6 }}>
      {onEditWithAi ? <button type="button" title="Edit with AI" aria-label="Edit with AI" style={btn} onClick={(e) => { e.stopPropagation(); onEditWithAi() }}>✨</button> : null}
      {onReplaceContent ? <button type="button" title="Replace content" aria-label="Replace content" style={btn} onClick={(e) => { e.stopPropagation(); onReplaceContent() }}>⇄</button> : null}
      {onDuplicate ? <button type="button" title="Duplicate" aria-label="Duplicate node" style={btn} onClick={(e) => { e.stopPropagation(); onDuplicate() }}>⧉</button> : null}
      {downloadUrl ? <a title="Download" aria-label="Download media" style={{ ...btn, textDecoration: 'none' }} href={downloadUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↓</a> : null}
      {onDelete ? <button type="button" title="Delete" aria-label="Delete node" style={{ ...btn, color: '#ff7a7a' }} onClick={(e) => { e.stopPropagation(); onDelete() }}>🗑</button> : null}
    </div>
  )
}
```

- [ ] Render bar in `nodeFactory` card chrome and `CombineNode` when any handler present (`opacity 0 → 1` on `:hover`/`.selected` via inline `onMouseEnter` state or a CSS class in globals — use selection: show when `props.selected`).
- [ ] Workspace `deleteNodeById(nodeId)`: `onNodesChange([{ type: 'remove', id: nodeId }])` (reuses removal/edge cleanup/activity). Generalize `duplicateSelectedNode` → `duplicateNodeById(nodeId)` keeping the old callsite.
- [ ] `onReplaceContent` → open `ReferencePicker` in replace mode (Task 4). `onEditWithAi` → open `NodeEditChat` (Task 5). `downloadUrl` = `output?.url ?? source?.url`.
- [ ] Tests: each button fires; delete removes node via workspace handler (existing workspace test harness).
- [ ] Typecheck + jest; commit `feat(creative-canvas): per-node action bar (delete/duplicate/AI edit/replace/download)`.

### Task 4: Replace node content via ReferencePicker

**Files:**
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` — `referencePicker` state gains `{ nodeId, mode: 'attach' | 'replace' }`; in replace mode `onSelect` rewrites the node's `source` (url/thumbnailUrl/mimeType/altText from the picked asset) instead of `attachReferenceUrl`, then saves graph.
- Test: extend `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`

- [ ] `replaceNodeContent(nodeId, asset)`: update `nodes` state mapping the target node's `data.canvasNode.source = { kind: 'upload', url: asset.url, thumbnailUrl: asset.thumbnailUrl, altText: asset.title, referenceRole: existing ?? 'general' }` + clear `output` if the node was an output-bearing source; record activity `node_update`.
- [ ] Test: replace flow swaps the URL on the node and marks graph dirty.
- [ ] Typecheck + jest; commit `feat(creative-canvas): replace node media from asset picker`.

### Task 5: NodeEditChat — inline AI edit with Branch/Replace

**Files:**
- Create: `components/creative-canvas/nodes/NodeEditChat.tsx`
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` — `editChat` state `{ nodeId } | null`; `runNodeEdit(nodeId, prompt, placement: 'branch' | 'replace')`.
- Test: `__tests__/components/creative-canvas/NodeEditChat.test.tsx` (create)

Component: textarea + segmented Branch|Replace (default Branch) + Generate + busy/error text; pinned near the node (fixed overlay, position passed in), calls `onSubmit(prompt, placement)`.

`runNodeEdit` behavior (client-side, reuses run pipeline):

```
const node = findCanvasNode(nodeId)
const mediaUrl = node.output?.url ?? node.source?.url
kind = node/video? 'video' : text-node ? 'text' : 'image'
- image/video: POST runs/generate { nodeId, model: kindDefault, prompt, referenceImageUrls: mediaUrl ? [mediaUrl] : [] }
- text: POST runs/generate with text model (agent-llm/text_generation) prompt = node text + instruction
then poll canvas (existing pattern) for `${nodeId}-output`:
- placement 'branch': keep server-inserted output node (already wired from original) — done.
- placement 'replace': copy output url/thumbnail/kind onto the original node (source for media, data.text for text), delete `${nodeId}-output` via onNodesChange remove, saveGraph('auto'). Version history preserves the prior graph.
```

- [ ] Failure paths set the popover error message (and `setActivityMessage`).
- [ ] Tests: submit posts correct payload for image node; replace placement applies output to original and removes transient node (mock fetch like existing generate tests).
- [ ] Typecheck + jest; commit `feat(creative-canvas): inline AI edit on nodes with branch/replace`.

### Task 6: One-tap media items in create menu

**Files:**
- Modify: `components/creative-canvas/canvas/createMenuItems.ts` — top group becomes `Image`, `Video`, `Audio`, `Text`, `Combine`, `Prompt`, then generators; media items are `{ type: 'source', label: 'Image', mode: 'media_image' }` etc.
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` — `addCanvasNodeAt` for `mode?.startsWith('media_')`: set `source.kind = 'upload'`, title = label, and immediately `setReferencePicker({ nodeId: id, mode: 'replace' })` so the picker opens to fill the node.
- Test: extend `__tests__/components/creative-canvas/CreateMenu.test.tsx`

- [ ] Typecheck + jest; commit `feat(creative-canvas): one-tap image/video/audio/text nodes`.

### Task 7: Selection tools wired

**Files:**
- Modify: `components/creative-canvas/canvas/CanvasStage.tsx` — accept `activeTool`; pass `selectionOnDrag={activeTool === 'select'}`, `panOnDrag={activeTool === 'select' ? [1, 2] : true}`, `selectionMode={SelectionMode.Partial}`.
- Test: extend `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx` (props smoke via mock)

- [ ] Typecheck + jest; commit `feat(creative-canvas): box-select with select tool, pan with hand tool`.

## Status (2026-07-02, end of session)

Tasks 1–7 implemented and verified (typecheck clean, all creative-canvas
suites green, DOM-level browser QA passed: New/Canvases buttons, landing
rename+delete E2E against Firestore, node action bar delete/duplicate,
Edit-with-AI popover with Branch/Replace, one-tap Image/Video/Audio/Text
menu). Bonus fix: `applyCanvasSnapshot` now preserves React Flow measured
state so remote snapshot refreshes can't blank the edges.

QA environment caveat: the preview browser runs as a hidden tab where Chrome
suspends ResizeObserver, so React Flow never measures nodes and edges don't
draw — this is NOT a code bug (verified by bisecting back to known-good
ae3e371d, which also showed no edges cold-loaded in a hidden tab). Edge
rendering was screenshot-verified in a visible tab on 2026-07-02 morning.

### Task 8: Full verification + push

- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --project tsconfig.typecheck.json`
- [ ] `npx jest __tests__/components/creative-canvas __tests__/lib/creative-canvas`
- [ ] Browser QA on localhost: create new canvas from top bar; rename + delete a board; add Image node → picker opens → asset lands; node action bar delete/duplicate; AI-edit an image node in branch mode (pipeline accepts; Higgsfield auth still gates pixels); box-select two nodes and delete.
- [ ] `git push origin development`.

*(Declutter of proof/certification UI runs as the separately queued background task and is not duplicated here.)*

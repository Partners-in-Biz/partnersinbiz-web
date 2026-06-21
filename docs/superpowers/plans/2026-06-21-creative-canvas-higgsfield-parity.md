# Creative Canvas — Higgsfield Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the PiB Creative Canvas presentation/interaction layer to match Higgsfield Canvas exactly (full-bleed dark+lime node editor, inline node generate-bars, searchable create-menu, slide-in settings panel, typed ports, floating toolbar, landing+templates) while keeping the mature backend and enterprise governance, and adding real inline generation.

**Architecture:** Reuse `lib/creative-canvas/*` backend wholesale. Quarantine the ~40% proof/benchmark scaffolding out of the 8,800-line component, then decompose the remainder into a focused component tree under `components/creative-canvas/{theme,canvas,nodes,panels,topbar,landing}`. Add two backend pieces only: `lib/creative-canvas/model-registry.ts` (model catalog) and a synchronous `runs/generate` endpoint that executes `xai` in-request and reuses the existing `completeCreativeCanvasRun` to insert the output node.

**Tech Stack:** Next.js 16 (App Router, webpack), React 19, `@xyflow/react` ^12.11, Tailwind v4, Jest + ts-jest + @testing-library/react. Tests in `__tests__/` (`*.test.ts` → node env, `*.test.tsx` → jsdom). `@/` maps to repo root.

**Conventions:**
- Branch: `development` only. Commit after every task. Co-author line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- After each phase: `npm run build` (runs typecheck) must pass; verify in browser preview.
- Reuse existing tokens where the spec says "dark+lime" — define new tokens in `theme/tokens.ts`, do not hardcode hex in components.

---

## File Structure

**New backend:**
- `lib/creative-canvas/model-registry.ts` — model catalog + lookups.
- `app/api/v1/creative-canvas/[id]/runs/generate/route.ts` — synchronous/inline generation.
- `lib/creative-canvas/inline-generation.ts` — provider execution for sync models (wraps Grok image logic).

**New frontend (replaces monolith incrementally):**
- `components/creative-canvas/theme/tokens.ts`
- `components/creative-canvas/canvas/{CanvasStage,CreateMenu,BottomToolbar,ZoomRail}.tsx`, `canvas/useGraphHistory.ts`, `canvas/createMenuItems.ts`
- `components/creative-canvas/nodes/{nodeTypes.ts,ports.ts,nodeFactory.tsx,ImageGeneratorNode,VideoGeneratorNode,PromptNode,VoiceNode,LLMAssistantNode,SourceNode,OutputNode,StickyNoteNode,TextNode,FolderNode}.tsx`
- `components/creative-canvas/panels/{NodeSettingsPanel,ModelPicker}.tsx`
- `components/creative-canvas/topbar/CanvasTopBar.tsx`
- `components/creative-canvas/landing/CanvasLanding.tsx`
- `components/creative-canvas/CreativeCanvasWorkspace.tsx` — slimmed shell (existing file, reduced).

**Moved (quarantine):**
- `lib/creative-canvas/workspace-proof-evidence.ts` — the proof/benchmark helpers extracted from the component.

**Tests (new):**
- `__tests__/lib/creative-canvas/model-registry.test.ts`
- `__tests__/lib/creative-canvas/inline-generation.test.ts`
- `__tests__/app/api/creative-canvas-run-generate-route.test.ts`
- `__tests__/components/creative-canvas/useGraphHistory.test.ts` (node env via rename to `.test.ts` using `renderHook` — see Task 1.3 note; place under jsdom by naming `.test.tsx`)
- `__tests__/components/creative-canvas/ports.test.ts`
- `__tests__/components/creative-canvas/ImageGeneratorNode.test.tsx`
- `__tests__/components/creative-canvas/CreateMenu.test.tsx`
- `__tests__/components/creative-canvas/ModelPicker.test.tsx`
- `__tests__/components/creative-canvas/CanvasLanding.test.tsx`

---

# Phase 1 — Foundation & Theme

Goal: quarantine proof scaffolding, add theme tokens, full-bleed shell, top bar, bottom toolbar, zoom rail with undo/redo, styled minimap and dotted grid. No change to generation behaviour.

### Task 1.1: Quarantine proof/benchmark scaffolding out of the component

**Files:**
- Create: `lib/creative-canvas/workspace-proof-evidence.ts`
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` (remove the proof types/helpers/constants identified in the audit: types ~67–553, helpers ~554–1925; import from the new module instead)
- Test: existing `__tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx` must still pass

- [ ] **Step 1: Identify the proof surface.** Open `CreativeCanvasWorkspace.tsx`. The proof/benchmark block is: the `VisualProof*`/`BenchmarkProof*` types and `emptyVisualProofDrafts`/`emptyBenchmarkProofDrafts`/`visualProofConfigs` constants, plus the ~60 module-level helpers whose names start with or contain `Proof`, `Benchmark`, `Evidence`, `collect…Evidence`, `build…ProofFields`, `getCanvasBenchmarkProof`. These are pure functions/data with no JSX and no React state.

- [ ] **Step 2: Move them verbatim** into `lib/creative-canvas/workspace-proof-evidence.ts`, exporting each symbol the component still references. Keep imports they need (from `@/lib/creative-canvas/*`).

- [ ] **Step 3: Replace in the component** with a single import:
```ts
import {
  // ...every moved symbol the JSX/handlers still use
} from '@/lib/creative-canvas/workspace-proof-evidence'
```

- [ ] **Step 4: Typecheck.**
Run: `npm run typecheck`
Expected: PASS (no missing symbols).

- [ ] **Step 5: Run the existing component test.**
Run: `npx jest __tests__/components/creative-canvas/CreativeCanvasWorkspace.test.tsx`
Expected: PASS unchanged.

- [ ] **Step 6: Commit.**
```bash
git add lib/creative-canvas/workspace-proof-evidence.ts components/creative-canvas/CreativeCanvasWorkspace.tsx
git commit -m "refactor(canvas): quarantine proof/benchmark scaffolding into lib

Moves ~1,300 lines of proof/benchmark-evidence helpers and types out of
CreativeCanvasWorkspace.tsx into lib/creative-canvas/workspace-proof-evidence.ts.
No behaviour change; shrinks the component surface for the parity rebuild.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.2: Theme tokens

**Files:**
- Create: `components/creative-canvas/theme/tokens.ts`

- [ ] **Step 1: Write tokens** (single source for the dark+lime palette; components consume these, never raw hex):
```ts
// Higgsfield-parity design tokens for the Creative Canvas surface.
export const canvasTheme = {
  bg: '#0b0d10',            // near-black canvas
  bgGridDot: '#23262b',     // dotted grid
  surface: '#15181d',       // node card / panel bg
  surfaceRaised: '#1c2027',
  border: '#2a2f37',
  borderActive: '#3a4150',
  text: '#e7eaf0',
  textMuted: '#8b93a1',
  accent: '#d4f000',        // neon lime — primary actions only
  accentText: '#0b0d10',    // text on lime
  accentGlow: '0 0 0 1px #d4f000, 0 0 16px -4px #d4f000',
  nodeShadow: '0 8px 30px -12px rgba(0,0,0,0.7)',
  radius: '14px',
  port: { image: '#5aa9ff', video: '#a06bff', audio: '#ff6bb0', text: '#9aa3b2', output: '#d4f000' },
} as const

export type CanvasPortKind = keyof typeof canvasTheme.port
```

- [ ] **Step 2: Typecheck.**
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit.**
```bash
git add components/creative-canvas/theme/tokens.ts
git commit -m "feat(canvas): Higgsfield-parity theme tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.3: In-session undo/redo history hook

**Files:**
- Create: `components/creative-canvas/canvas/useGraphHistory.ts`
- Test: `__tests__/components/creative-canvas/useGraphHistory.test.tsx` (named `.tsx` → jsdom project, so `renderHook` works)

- [ ] **Step 1: Write the failing test.**
```tsx
import { renderHook, act } from '@testing-library/react'
import { useGraphHistory } from '@/components/creative-canvas/canvas/useGraphHistory'

test('records snapshots and undoes/redoes', () => {
  const { result } = renderHook(() => useGraphHistory({ nodes: [], edges: [] }))
  act(() => result.current.commit({ nodes: [{ id: 'a' }], edges: [] } as any))
  act(() => result.current.commit({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] } as any))
  expect(result.current.canUndo).toBe(true)
  let snap: any
  act(() => { snap = result.current.undo() })
  expect(snap.nodes.map((n: any) => n.id)).toEqual(['a'])
  expect(result.current.canRedo).toBe(true)
  act(() => { snap = result.current.redo() })
  expect(snap.nodes.map((n: any) => n.id)).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run test to verify it fails.**
Run: `npx jest __tests__/components/creative-canvas/useGraphHistory.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**
```ts
import { useCallback, useRef, useState } from 'react'

export interface GraphSnapshot { nodes: unknown[]; edges: unknown[] }

export function useGraphHistory(initial: GraphSnapshot) {
  const past = useRef<GraphSnapshot[]>([])
  const future = useRef<GraphSnapshot[]>([])
  const present = useRef<GraphSnapshot>(initial)
  const [, force] = useState(0)
  const tick = () => force((n) => n + 1)

  const commit = useCallback((next: GraphSnapshot) => {
    past.current.push(present.current)
    present.current = next
    future.current = []
    tick()
  }, [])

  const undo = useCallback((): GraphSnapshot => {
    const prev = past.current.pop()
    if (!prev) return present.current
    future.current.push(present.current)
    present.current = prev
    tick()
    return prev
  }, [])

  const redo = useCallback((): GraphSnapshot => {
    const next = future.current.pop()
    if (!next) return present.current
    past.current.push(present.current)
    present.current = next
    tick()
    return next
  }, [])

  return {
    commit, undo, redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes.**
Run: `npx jest __tests__/components/creative-canvas/useGraphHistory.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add components/creative-canvas/canvas/useGraphHistory.ts __tests__/components/creative-canvas/useGraphHistory.test.tsx
git commit -m "feat(canvas): in-session graph undo/redo history hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.4: ZoomRail, BottomToolbar, full-bleed CanvasStage + dotted dark background

**Files:**
- Create: `components/creative-canvas/canvas/ZoomRail.tsx`, `components/creative-canvas/canvas/BottomToolbar.tsx`, `components/creative-canvas/canvas/CanvasStage.tsx`
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` (drop `max-w-7xl` frame; render `CanvasStage` full-bleed; remove default `<Controls/>`)

- [ ] **Step 1: ZoomRail** — left vertical rail using `useReactFlow().zoomIn/zoomOut/fitView` + the history hook for undo/redo. Buttons: zoom in, zoom out, fit, undo (disabled when `!canUndo`), redo (disabled when `!canRedo`). Style from `canvasTheme`.

- [ ] **Step 2: BottomToolbar** — floating centered dock with tool buttons: select (pointer), pan (hand), sticky-note, text, connector, reaction, comment, frame, "+". Each emits an `onTool(tool)` callback (wired to behaviours in later tasks; for now select/pan/sticky/text/"+" active, others render disabled-with-tooltip to match Higgsfield's affordance set without dead clicks).

- [ ] **Step 3: CanvasStage** — wraps `<ReactFlow>` full-bleed (`position:absolute inset-0`), `colorMode="dark"`, `<Background variant={BackgroundVariant.Dots} color={canvasTheme.bgGridDot} gap={22} />`, styled `<MiniMap>` (dark, lime node mask), `connectionLineType="bezier"`, `defaultEdgeOptions={{ type: 'default', animated: false }}`. Renders `ZoomRail` and `BottomToolbar` as children overlays. Accepts `nodes,edges,onNodesChange,onEdgesChange,onConnect,onPaneDoubleClick,onPaneContextMenu,nodeTypes` props (the last three default no-op until Phase 2).

- [ ] **Step 4: Wire into the shell.** In `CreativeCanvasWorkspace.tsx`, replace the embedded ReactFlow `<section>` and its `max-w-7xl` wrapper with `<CanvasStage .../>`. The left/right dashboard columns are removed in Phase 3 (settings panel) and Phase 5 (landing); for this task keep them but let the canvas fill the center. Feed `onNodesChange/onEdgesChange` through `commit()` so undo/redo records edits.

- [ ] **Step 5: Build.**
Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Browser verify.** Start preview, open `/admin/creative-canvas`, confirm: dark full-bleed canvas, dotted grid, lime-accented zoom rail + bottom toolbar visible, undo/redo enable after moving a node, minimap dark. Capture a screenshot.

- [ ] **Step 7: Commit.**
```bash
git add components/creative-canvas/canvas/ components/creative-canvas/CreativeCanvasWorkspace.tsx
git commit -m "feat(canvas): full-bleed dark stage, zoom rail, bottom toolbar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.5: CanvasTopBar (rename, Team Chat, Share)

**Files:**
- Create: `components/creative-canvas/topbar/CanvasTopBar.tsx`
- Modify: `components/creative-canvas/CreativeCanvasWorkspace.tsx` (replace static `<h1>Creative Canvas</h1>` header)

- [ ] **Step 1:** Build `CanvasTopBar` with: logo slot, inline-editable title (click → input → blur/Enter calls `onRename(title)` which PUTs `/api/v1/creative-canvas/[id]`), a **Team Chat** button (`onOpenChat`, opens existing comments/presence drawer), a **Share** button (`onShare`, opens a share modal reusing canvas `visibility` + a copyable link). Dark styling.

- [ ] **Step 2:** Wire `onRename` to the existing canvas update call already in the component; `onOpenChat`/`onShare` open lightweight drawers/modals (presence + comments already loaded via SSE).

- [ ] **Step 3: Build + browser verify** rename persists (reload shows new title), buttons open their panels. Screenshot.

- [ ] **Step 4: Commit.**
```bash
git add components/creative-canvas/topbar/CanvasTopBar.tsx components/creative-canvas/CreativeCanvasWorkspace.tsx
git commit -m "feat(canvas): Higgsfield-style top bar with rename, Team Chat, Share

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Phase 1 gate:** `npm run build` green; `/admin/creative-canvas` looks like a dark Higgsfield canvas shell. Run full canvas test suite: `npx jest creative-canvas` → all pass.

---

# Phase 2 — Nodes & Create Menu

Goal: real `nodeTypes`, custom generator node cards with typed ports + inline generate bars, bezier edges + reference fan-out, and the double/right-click searchable create menu.

### Task 2.1: Typed ports + connection validation

**Files:**
- Create: `components/creative-canvas/nodes/ports.ts`
- Test: `__tests__/components/creative-canvas/ports.test.ts`

- [ ] **Step 1: Failing test.**
```ts
import { portsForNode, isValidConnection } from '@/components/creative-canvas/nodes/ports'

test('image generator exposes image+text inputs and image output', () => {
  const p = portsForNode('image_generator')
  expect(p.inputs.map((i) => i.kind).sort()).toEqual(['image', 'text'])
  expect(p.output.kind).toBe('image')
})

test('rejects connecting a video output into an image-only input', () => {
  expect(isValidConnection('video', 'image')).toBe(false)
  expect(isValidConnection('image', 'image')).toBe(true)
  expect(isValidConnection('image', 'text')).toBe(false)
})
```

- [ ] **Step 2: Run → FAIL.**
Run: `npx jest __tests__/components/creative-canvas/ports.test.ts`

- [ ] **Step 3: Implement.**
```ts
import type { CanvasPortKind } from '@/components/creative-canvas/theme/tokens'

export type CanvasNodeType =
  | 'prompt' | 'image_generator' | 'video_generator' | 'voice_generator'
  | 'llm_assistant' | 'voiceover' | 'change_voice' | 'translate'
  | 'source' | 'output' | 'sticky_note' | 'text' | 'folder'

export interface Port { id: string; kind: CanvasPortKind }
export interface NodePorts { inputs: Port[]; output: Port }

const MAP: Record<CanvasNodeType, NodePorts> = {
  prompt:           { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  image_generator:  { inputs: [{ id: 'in_img', kind: 'image' }, { id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'image' } },
  video_generator:  { inputs: [{ id: 'in_img', kind: 'image' }, { id: 'in_vid', kind: 'video' }, { id: 'in_aud', kind: 'audio' }, { id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'video' } },
  voice_generator:  { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'audio' } },
  llm_assistant:    { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  voiceover:        { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'audio' } },
  change_voice:     { inputs: [{ id: 'in_aud', kind: 'audio' }], output: { id: 'out', kind: 'audio' } },
  translate:        { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  source:           { inputs: [], output: { id: 'out', kind: 'image' } },
  output:           { inputs: [{ id: 'in', kind: 'image' }], output: { id: 'out', kind: 'image' } },
  sticky_note:      { inputs: [], output: { id: 'out', kind: 'text' } },
  text:             { inputs: [], output: { id: 'out', kind: 'text' } },
  folder:           { inputs: [], output: { id: 'out', kind: 'text' } },
}

export function portsForNode(type: CanvasNodeType): NodePorts { return MAP[type] }
export function isValidConnection(from: CanvasPortKind, to: CanvasPortKind): boolean { return from === to }
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** (`feat(canvas): typed node ports and connection validation`).

### Task 2.2: Node card factory + ImageGeneratorNode (inline generate bar)

**Files:**
- Create: `components/creative-canvas/nodes/nodeFactory.tsx`, `components/creative-canvas/nodes/ImageGeneratorNode.tsx`
- Test: `__tests__/components/creative-canvas/ImageGeneratorNode.test.tsx`

- [ ] **Step 1:** `nodeFactory.tsx` exports `GeneratorNodeCard` — a presentational card rendering: title bar, typed `<Handle>`s (one per port from `portsForNode`, colored by `canvasTheme.port[kind]`, positioned left=inputs/right=output), an optional asset preview, and an **inline generate bar**: prompt `<textarea>`, a model chip (opens picker — Phase 3, for now shows `data.model` label), a batch stepper (1–4), and a **Generate** button showing `creditCost` with an `onGenerate` callback. All visual state comes from `data`; the card is dumb.

- [ ] **Step 2:** `ImageGeneratorNode.tsx` = `memo((props: NodeProps) => <GeneratorNodeCard type="image_generator" {...} />)` mapping `data` → card props and forwarding `data.onGenerate`/`data.onChange`.

- [ ] **Step 3: Failing test** (jsdom):
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import ImageGeneratorNode from '@/components/creative-canvas/nodes/ImageGeneratorNode'

function renderNode(data: any) {
  return render(
    <ReactFlowProvider>
      <ImageGeneratorNode id="n1" type="image_generator" data={data}
        selected={false} zIndex={0} isConnectable dragging={false}
        xPos={0} yPos={0} /* @ts-expect-error minimal NodeProps */ />
    </ReactFlowProvider>
  )
}

test('renders prompt, model label and a Generate button with credit cost', () => {
  const onGenerate = jest.fn()
  renderNode({ title: 'Image Generation', model: 'Grok Image', prompt: '', creditCost: 7, onGenerate, onChange: () => {} })
  expect(screen.getByText('Grok Image')).toBeInTheDocument()
  const btn = screen.getByRole('button', { name: /generate/i })
  expect(btn).toHaveTextContent('7')
  fireEvent.click(btn)
  expect(onGenerate).toHaveBeenCalled()
})
```

- [ ] **Step 4: Run → FAIL, implement card+node until PASS.**
Run: `npx jest __tests__/components/creative-canvas/ImageGeneratorNode.test.tsx`

- [ ] **Step 5: Commit** (`feat(canvas): generator node card with inline generate bar + ImageGeneratorNode`).

### Task 2.3: Remaining node components + nodeTypes registry

**Files:**
- Create: `components/creative-canvas/nodes/{VideoGeneratorNode,PromptNode,VoiceNode,LLMAssistantNode,SourceNode,OutputNode,StickyNoteNode,TextNode,FolderNode}.tsx`, `components/creative-canvas/nodes/nodeTypes.ts`
- Modify: graph mappers in `CreativeCanvasWorkspace.tsx` (`toFlowNode`) to set real `type` and structured `data`; pass `nodeTypes` to `CanvasStage`.

- [ ] **Step 1:** Each generator-style node (`VideoGeneratorNode`, `VoiceNode`, `LLMAssistantNode`) reuses `GeneratorNodeCard` with its own `type`. `StickyNoteNode`/`TextNode` are simple editable text cards (no generate bar). `SourceNode` shows an asset thumbnail + output port. `OutputNode` shows the rendered asset + a review-status pill. `FolderNode` is a labeled group container.

- [ ] **Step 2:** `nodeTypes.ts`:
```ts
import ImageGeneratorNode from './ImageGeneratorNode'
import VideoGeneratorNode from './VideoGeneratorNode'
/* ...imports... */
export const canvasNodeTypes = {
  image_generator: ImageGeneratorNode,
  video_generator: VideoGeneratorNode,
  prompt: PromptNode,
  voice_generator: VoiceNode,
  llm_assistant: LLMAssistantNode,
  voiceover: VoiceNode,
  change_voice: VoiceNode,
  translate: PromptNode,
  source: SourceNode,
  output: OutputNode,
  sticky_note: StickyNoteNode,
  text: TextNode,
  folder: FolderNode,
} as const
```

- [ ] **Step 3:** Rebuild `toFlowNode` to emit `{ type: <CanvasNodeType>, data: { title, prompt, model, creditCost, batch, asset, review, onGenerate, onChange } }` instead of `type:'default'` with JSX. Map legacy node types (`source/prompt/model/edit/review/output`) onto the new set (`model`→`image_generator` default; keep `source/prompt/output`; `edit`→`image_generator` with edit mode; `review`→`output` with review pill).

- [ ] **Step 4: Build + browser verify** existing canvases render as styled cards with colored typed ports; dragging an output handle to a compatible input connects with a bezier edge; connecting incompatible types is rejected. Screenshot. **Step 5: Commit** (`feat(canvas): custom node type registry + typed-port rendering`).

### Task 2.4: Searchable create menu (double/right-click)

**Files:**
- Create: `components/creative-canvas/canvas/createMenuItems.ts`, `components/creative-canvas/canvas/CreateMenu.tsx`
- Test: `__tests__/components/creative-canvas/CreateMenu.test.tsx`
- Modify: `CanvasStage` (wire `onPaneContextMenu`/`onDoubleClick` to open menu at cursor), `CreativeCanvasWorkspace` (`addCanvasNode(type, position)`)

- [ ] **Step 1:** `createMenuItems.ts` exports the grouped item list mirroring Higgsfield:
```ts
export const createMenuGroups = [
  { group: '', items: [
    { type: 'prompt', label: 'Prompt' }, { type: 'image_generator', label: 'Image Generator' },
    { type: 'video_generator', label: 'Video Generator' }, { type: 'voice_generator', label: 'Voice Generator' },
    { type: 'llm_assistant', label: 'LLM Assistant' }, { type: 'folder', label: 'Folders' } ] },
  { group: 'References', items: [ { type: 'source', label: 'Upload', mode: 'upload' }, { type: 'source', label: 'Assets', mode: 'assets' } ] },
  { group: 'Audio', items: [ { type: 'voiceover', label: 'Voiceover' }, { type: 'change_voice', label: 'Change Voice' }, { type: 'translate', label: 'Translate' } ] },
  { group: 'Utilities', items: [ { type: 'text', label: 'Text' }, { type: 'sticky_note', label: 'Sticky Note' } ] },
] as const
```

- [ ] **Step 2: Failing test:** renders a search box; typing "vid" filters to "Video Generator"; clicking it calls `onCreate('video_generator', mode?)`.
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import CreateMenu from '@/components/creative-canvas/canvas/CreateMenu'
test('filters by search and creates on click', () => {
  const onCreate = jest.fn()
  render(<CreateMenu position={{ x: 10, y: 10 }} onCreate={onCreate} onClose={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'vid' } })
  fireEvent.click(screen.getByText('Video Generator'))
  expect(onCreate).toHaveBeenCalledWith('video_generator', undefined)
})
```

- [ ] **Step 3: Run → FAIL; implement CreateMenu** (absolute-positioned popover at `position`, search input, grouped filtered list, Esc/blur closes). Run → PASS.

- [ ] **Step 4:** Wire in `CanvasStage`: `onDoubleClick`/`onPaneContextMenu` (preventDefault) capture screen→flow position via `useReactFlow().screenToFlowPosition` and open `CreateMenu`; `onCreate` calls `addCanvasNode(type, position, mode)` which inserts a node and `commit()`s history.

- [ ] **Step 5: Build + browser verify:** double-click empty canvas → menu opens → search → create node at cursor. Screenshot. **Step 6: Commit** (`feat(canvas): searchable double/right-click create menu`).

**Phase 2 gate:** build green; nodes are Higgsfield-style cards with typed ports; create-menu works; `npx jest creative-canvas` passes.

---

# Phase 3 — Model Registry & Settings Panel

### Task 3.1: Model registry

**Files:**
- Create: `lib/creative-canvas/model-registry.ts`
- Test: `__tests__/lib/creative-canvas/model-registry.test.ts`

- [ ] **Step 1: Failing test.**
```ts
import { CANVAS_MODELS, getCanvasModel, modelsForKind, featuredModels } from '@/lib/creative-canvas/model-registry'

test('every model has a stable id, provider key and credit cost', () => {
  for (const m of CANVAS_MODELS) {
    expect(typeof m.id).toBe('string')
    expect(['higgsfield','xai','agent_task','manual_upload']).toContain(m.providerKey)
    expect(m.creditCost).toBeGreaterThanOrEqual(0)
  }
})
test('there is a synchronous xai image model for inline generation', () => {
  const sync = modelsForKind('image').find((m) => m.execution === 'sync' && m.providerKey === 'xai')
  expect(sync).toBeTruthy()
  expect(getCanvasModel(sync!.id)).toEqual(sync)
})
test('featuredModels is a non-empty subset', () => {
  expect(featuredModels().length).toBeGreaterThan(0)
  expect(featuredModels().every((m) => m.featured)).toBe(true)
})
```

- [ ] **Step 2: Run → FAIL.**
Run: `npx jest __tests__/lib/creative-canvas/model-registry.test.ts`

- [ ] **Step 3: Implement** the `CanvasModel` interface (from the spec) + a V1 catalog reflecting PiB's real providers. Minimum entries:
  - `grok-image` — label "Grok Image", family "xAI", kind image, providerKey `xai`, execution `sync`, aspectRatios `['1:1','9:16','16:9']`, resolutions `['1k','2k']`, maxBatch 4, creditCost 7, featured true, capabilities `['generate_image','create_variants']`.
  - `higgsfield-image` — label "Higgsfield Image", family "Higgsfield", kind image, providerKey `higgsfield`, execution `async`, featured true.
  - `higgsfield-video` — label "Higgsfield Video", family "Higgsfield", kind video, providerKey `higgsfield`, execution `async`, durations `[4,8,15]`, supportsAudio true, creditCost 68, featured true.
  - `agent-voiceover` — kind audio, providerKey `agent_task`, execution `async`.
  - `agent-llm` — kind text, providerKey `agent_task`, execution `async`.
  Exports: `CANVAS_MODELS`, `getCanvasModel(id)`, `modelsForKind(kind)`, `featuredModels()`.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(canvas): model registry catalog`).

### Task 3.2: ModelPicker (searchable, Featured/All, families)

**Files:**
- Create: `components/creative-canvas/panels/ModelPicker.tsx`
- Test: `__tests__/components/creative-canvas/ModelPicker.test.tsx`

- [ ] **Step 1: Failing test:** renders a search box, a "Featured models" group and an "All models" group; filtering by "grok" shows "Grok Image"; selecting it calls `onSelect('grok-image')`.

- [ ] **Step 2: Implement** consuming `featuredModels()` + `modelsForKind(kind)`; group by `featured` then by `family`; search filters by label/family; Higgsfield-styled dark popover. Run test → PASS.

- [ ] **Step 3: Commit** (`feat(canvas): searchable grouped model picker`).

### Task 3.3: NodeSettingsPanel (slide-in, Configure + tucked enterprise tabs)

**Files:**
- Create: `components/creative-canvas/panels/NodeSettingsPanel.tsx`
- Modify: `CreativeCanvasWorkspace.tsx` (replace the static right column; open panel on node select; remove old 3-column layout)

- [ ] **Step 1:** Panel animates in from the right when `selectedNodeId` set. Tabs:
  - **Configure** (default): `ModelPicker` chip, Aspect Ratio, then conditionally Resolution+Quality (image) or Duration+Generate-Audio toggle (video), Batch Size stepper, **Generate** button (credit cost from registry). Driven by the selected node's kind via `getCanvasModel`.
  - **Review**: brand/rights/approval pills + actions (reuse existing review API calls).
  - **Provenance**: provider, model, cost label, prompt-stored, synthetic-media (from the latest run).
  - **Exports**: the existing export adapter actions.
  Writing a Configure field updates node `data` and persists via the existing graph save.

- [ ] **Step 2:** Remove the legacy static inspector/agent-control columns now superseded (the `[260px|1fr|280px]` grid → full-bleed canvas + overlay panel). Keep all handler logic; only the container changes.

- [ ] **Step 3: Build + browser verify:** select an image node → panel slides in with Model/Aspect/Resolution/Quality/Batch/Generate; select a video node → Duration/Generate-Audio shown; Review/Provenance/Export tabs populated. Screenshot. **Step 4: Commit** (`feat(canvas): slide-in node settings panel with tucked enterprise tabs`).

**Phase 3 gate:** build green; default surface is clean+Higgsfield-like, enterprise controls one tab away; `npx jest creative-canvas` passes.

---

# Phase 4 — Inline Generation

### Task 4.1: Inline (synchronous) generation lib

**Files:**
- Create: `lib/creative-canvas/inline-generation.ts`
- Test: `__tests__/lib/creative-canvas/inline-generation.test.ts`

- [ ] **Step 1: Failing test** (mock the Grok image call): `generateInline({ providerKey:'xai', model:'grok-image', prompt, aspectRatio })` returns `{ url, mimeType }`; for an `async` model it throws `InlineNotSupportedError` so the route falls back to the queue path.

- [ ] **Step 2: Implement** by extracting/reusing the Grok image logic from `app/api/v1/social/ai/image/route.ts` (map aspectRatio → its size param). Export `generateInline(input)` and `InlineNotSupportedError`. Keep it provider-pure (no Firestore).

- [ ] **Step 3: Run → PASS. Commit** (`feat(canvas): inline xai image generation lib`).

### Task 4.2: `runs/generate` endpoint

**Files:**
- Create: `app/api/v1/creative-canvas/[id]/runs/generate/route.ts`
- Test: `__tests__/app/api/creative-canvas-run-generate-route.test.ts`

- [ ] **Step 1: Failing test** (follow the pattern in `__tests__/app/api/creative-canvas-run-create-route.test.ts`): POST with a sync model → response contains a completed run + an output node; tenancy mismatch → 403; portal user + expensive async model → blocked per governance.

- [ ] **Step 2: Implement.** Resolve model via `getCanvasModel`. If `execution==='sync'` and provider creds present: `createCreativeCanvasRun` → `generateInline` → `completeCreativeCanvasRun` (which inserts the output node+edge) → return the completed run + new node. Else: create the queued run exactly as the existing `/runs` route and return `{ run, pending: true }`. **Reuse the existing tenancy + approval-gate guards** from the create route; do not weaken them.

- [ ] **Step 3: Run → PASS. Commit** (`feat(canvas): synchronous runs/generate endpoint with async fallback`).

### Task 4.3: Wire Generate buttons → live render

**Files:**
- Modify: `CreativeCanvasWorkspace.tsx` (node `data.onGenerate` + panel Generate), `nodes/OutputNode.tsx`

- [ ] **Step 1:** `onGenerate(nodeId)` POSTs `/runs/generate` with the node's model+settings. On a sync completion, the returned output node renders immediately in-card (set node status `done`, show asset). On `pending:true`, set node status `queued`→poll `GET /runs` until the output node appears (fast-poll 2s; reuse existing runs list response), then render. Show a spinner/progress state on the card during generation, matching Higgsfield's queued→running→done.

- [ ] **Step 2: Build + browser verify:** add an Image Generator node, type a prompt, pick "Grok Image", click Generate → a real image renders in/near the node within the request; add a Higgsfield video node → shows queued→polling state. Capture screenshot + network evidence. **Step 3: Commit** (`feat(canvas): live inline generation wired to node Generate buttons`).

**Phase 4 gate:** build green; clicking Generate on a Grok image node produces a real rendered image in-node; async video queues and resolves; `npx jest creative-canvas` passes.

---

# Phase 5 — Landing & Templates

### Task 5.1: CanvasLanding (board list + All Canvases/Templates tabs + gallery)

**Files:**
- Create: `components/creative-canvas/landing/CanvasLanding.tsx`
- Test: `__tests__/components/creative-canvas/CanvasLanding.test.tsx`
- Modify: the route page(s) `app/admin/creative-canvas` / `app/portal/creative-canvas` to show landing when no canvas is selected.

- [ ] **Step 1: Failing test:** renders "All Canvases" and "Templates" tabs; All Canvases lists provided boards and a "Create Canvas" card (calls `onCreate`); switching to Templates shows template cards (calls `onUseTemplate(id)`).

- [ ] **Step 2: Implement** a Higgsfield-style dark gallery: board grid with thumbnails + "last edited", a create card, and a Templates tab fed by the templates API / existing `workflowPresets`, each card cloning a starter graph. Run test → PASS.

- [ ] **Step 3:** Route integration: show `CanvasLanding` at the base route; opening/creating/using-template navigates into the full-bleed workspace.

- [ ] **Step 4: Build + browser verify:** landing matches Higgsfield (tabs, gallery, create); opening a template seeds a starter graph. Screenshot. **Step 5: Commit** (`feat(canvas): landing with All-Canvases/Templates tabs and gallery`).

**Phase 5 gate:** build green; landing → board → full-bleed Higgsfield canvas end-to-end; `npx jest creative-canvas` all pass.

---

## Final verification (before declaring parity)

- [ ] `npm run build` passes.
- [ ] `npx jest creative-canvas` — entire canvas suite green.
- [ ] Browser walkthrough on `/admin/creative-canvas`: landing tabs → create canvas → double-click create-menu → Image Generator node → Grok Image → Generate → real image renders → settings panel Model/Aspect/Resolution/Quality/Batch → Review/Provenance/Export tabs present → bottom toolbar + zoom rail + undo/redo + minimap → rename + Share + Team Chat. Capture screenshots for each.
- [ ] Governance check: portal user cannot run expensive async providers or bypass approval gates (existing policy tests still pass).
- [ ] Push `origin/development`.

---

## Self-Review

**Spec coverage:** Behaviours 1–10 from the spec each map to a task — create-menu (2.4), inline node bars (2.2/2.3), settings panel (3.3), model picker (3.1/3.2), typed ports/bezier (2.1/2.3), toolbar/zoom-rail/minimap (1.4), dark+lime theme (1.2/throughout), top bar rename/chat/share (1.5), landing+templates (5.1), full-bleed dark canvas (1.4). Backend additions: model-registry (3.1), inline-generation (4.1/4.2). Enterprise "tucked" layer (3.3 tabs). Quarantine (1.1).

**Placeholder scan:** No "TBD/TODO"; net-new testable units (history hook, ports, registry, inline-gen, endpoint, components) carry full code or exact contracts + tests. Large reskin tasks specify exact files, props, and verification rather than every JSX line (appropriate for component work) and each has a browser-verify + commit step.

**Type consistency:** `CanvasNodeType` (ports.ts) is the single node-type vocabulary reused by `nodeTypes.ts`, `createMenuItems.ts`, and `toFlowNode`. `CanvasModel`/`getCanvasModel`/`modelsForKind`/`featuredModels` names are consistent across 3.1, 3.2, 3.3, 4.1, 4.2. `useGraphHistory.commit/undo/redo/canUndo/canRedo` consistent across 1.3 and 1.4. `generateInline`/`InlineNotSupportedError` consistent across 4.1 and 4.2.

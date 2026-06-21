# Creative Canvas — Higgsfield Parity Design Spec

**Status:** approved direction (blueprint approved by Peet 2026-06-21), written spec for review.
**Date:** 2026-06-21.
**Owner:** Pip.
**Builds on:** [2026-06-19-creative-canvas-design.md](./2026-06-19-creative-canvas-design.md) (Universal Canvas Foundation). This is a **delta spec** — it changes the presentation/interaction layer and adds inline generation; it does not change the governance, tenancy, run, or export model from the foundation spec.

## Goal

Make the PiB Creative Canvas look and behave **exactly like Higgsfield Canvas** (https://higgsfield.ai/canvas), with:

- **Full UX + behaviour parity** (not just a skin).
- **Enterprise layer kept but tucked** behind the Higgsfield-style UI (approval gates, tenancy, provenance, exports preserved; demoted visually).
- **Real inline generation** — Generate buttons actually call providers and render assets in-node, with credit cost shown.

Decided with Peet 2026-06-21.

## Source of truth: observed Higgsfield Canvas behaviour

Captured live from a logged-in session 2026-06-21. The reference write-up lives at `~/Cowork/Cowork/shared/wiki/higgsfield-canvas.md`. The behaviours to match:

1. Infinite, full-bleed dark canvas with a dotted grid; pan/zoom.
2. **Double-click or right-click empty canvas → searchable command menu** to create a node. Groups: Prompt, Image Generator, Video Generator, Voice Generator, LLM Assistant, Folders; References (Upload, Assets); Audio (Voiceover, Change Voice, Translate); Utilities (Text, Sticky Note).
3. **Node cards carry an inline generate bar**: prompt textarea + model chip + batch stepper + Generate button showing credit cost.
4. Selecting a node opens a **right slide-in settings panel**: Model · Aspect Ratio · Resolution · Quality (image) / Duration · Generate Audio (video) · Batch Size · Generate.
5. **Searchable model picker** with "Featured" and "All models" groups, model families with sub-menus.
6. **Typed ports** (image/video/audio/text input handles + output handle); curved (bezier) edges; reference images fan out into many downstream nodes.
7. **Floating bottom toolbar** (select, pan, sticky note, text, connector, reaction, comment, frame, "+") + **left zoom rail** (zoom in/out, fit, undo, redo) + **minimap**.
8. Dark theme, **neon-lime accent** (~`#d4f000`) on primary actions, rounded glowing node cards.
9. **Top bar**: inline board rename, **Team Chat**, **Share**.
10. **Landing**: board list with **All Canvases / Templates** tabs + a visual template gallery.

## Current state (audit 2026-06-21)

Frontend (`components/creative-canvas/CreativeCanvasWorkspace.tsx`, 8,800 lines):

- **One ~5,700-line component**, ~120 `useState`, no sub-components except `CanvasPreviewBlock`. Not decomposed.
- **~40% of the file is "parity-proof / benchmark-evidence" scaffolding** (types, ~60 helpers, audit JSX panels) unrelated to Canvas UX.
- Layout is a centered `max-w-7xl` **dashboard** with a small embedded `<ReactFlow>` pane and a static 3-column form — **not** a full-bleed canvas.
- Nodes render as `type:'default'` with JSX in `data.label`; **no custom `nodeTypes`**.
- Light theme, brand-color accent. Default `<Background/>`, default `<Controls/>`, default `<MiniMap/>`.
- Generation = a **"Queue run"** button in the right inspector → `POST /api/v1/creative-canvas/[id]/runs` (async).
- No command menu, no bottom toolbar, no undo/redo, no inline node bars, no grouped model picker, no landing/gallery.

Backend (`lib/creative-canvas/*`, 20+ modules) — **mature, reused as-is**:

- Run lifecycle is solid: `createCreativeCanvasRun` → dispatch → `completeCreativeCanvasRun`, which **auto-inserts an output node + edge** into the graph and bumps `activeVersion`.
- Providers registered: `manual_upload`, `xai`, `higgsfield`, `agent_task`. (`text_generation`, `document_generation` are type-only, unimplemented.)
- **No model catalog** — `model` is a free string; only `nano_banana_flash` appears, as a hardcoded default.
- Generation is **async / agent-mediated**: Higgsfield runs off-platform inside a Hermes (Maya) session via a manifest; no synchronous render; **no real credit metering** (cost labels only).
- **`xai` is declared but never executed in the run path.** A working synchronous Grok image generator already exists at `app/api/v1/social/ai/image`.
- API surface is complete for CRUD, graph save, runs (create/list/complete/dispatch/status/retry), nodes output/review, comments, presence (incl. SSE), exports, templates, sources, provider-callbacks.

## Design

### Principle

Reuse the backend wholesale. Rebuild the presentation/interaction layer to Higgsfield parity while decomposing the monolith. Add exactly two backend pieces: a **model registry** and an **inline (synchronous) generation path**.

### Backend additions

**1. `lib/creative-canvas/model-registry.ts` (new).** The catalog the picker and generate-bars render from, and the bridge between Higgsfield-style model UX and PiB providers.

```ts
interface CanvasModel {
  id: string                 // stable key written to run.model, e.g. 'grok-image'
  label: string              // display, e.g. 'Grok Image'
  family: string             // group label, e.g. 'xAI', 'Higgsfield', 'ByteDance'
  featured: boolean
  kind: 'image' | 'video' | 'audio' | 'text'
  providerKey: CreativeCanvasProviderKey
  capabilities: ProviderCapability[]
  aspectRatios: string[]     // ['1:1','9:16','16:9',...]
  resolutions?: string[]     // image: ['1k','2k','4k']
  durations?: number[]       // video seconds: [4,8,15]
  supportsAudio?: boolean    // video
  maxBatch: number           // 1..4
  creditCost: number         // shown on Generate; per the foundation spec, Higgsfield is credit-metered
  execution: 'sync' | 'async'
  description?: string
}
```

V1 catalog reflects **PiB's real providers** (full parity, not pixel-perfect clone — we don't list models we can't run). Image: a synchronous `xai`-backed "Grok Image" (real inline render). Video + advanced image: `higgsfield`-backed entries (async, Hermes/Maya execution) modelled on Seedance/Kling/Soul classes. Audio/LLM: `agent_task`-backed entries. Registry is additive — it feeds the existing `run.model` string and `input.*` fields with **no schema change**.

**2. Inline generation endpoint.** `POST /api/v1/creative-canvas/[id]/runs/generate` (new) — for `execution:'sync'` models it runs the provider in-request and calls `completeCreativeCanvasRun` before responding, so the rendered asset (and its auto-created output node) returns immediately. V1 wires `xai` by reusing the Grok image generator logic from `app/api/v1/social/ai/image`. For `execution:'async'` models it falls back to the existing queue path and the client polls `GET /runs` (fast-poll; an SSE upgrade can reuse the existing `presence/events` SSE pattern). Governance unchanged: tenancy checks, approval gates, and client-portal run restrictions from the foundation spec still apply (portal users cannot run expensive async providers).

### Frontend rebuild

**Quarantine first.** Move the parity-proof/benchmark-evidence scaffolding out of the component into `lib/creative-canvas/` (it is data/evidence logic, not UI). This shrinks the workspace surface ~8,800 → ~3,000 lines before restructuring.

**Decompose into a focused tree** (replaces the monolith incrementally; each unit one purpose, testable):

```
components/creative-canvas/
  CreativeCanvasWorkspace.tsx     // thin shell: data load, state, layout
  theme/tokens.ts                 // dark + neon-lime design tokens
  canvas/CanvasStage.tsx          // full-bleed <ReactFlow>, dotted Background, MiniMap, nodeTypes
  canvas/CreateMenu.tsx           // double/right-click searchable command menu
  canvas/BottomToolbar.tsx        // floating tool dock
  canvas/ZoomRail.tsx             // zoom/fit + undo/redo (new history stack)
  canvas/useGraphHistory.ts       // in-session undo/redo over nodes+edges
  nodes/ImageGeneratorNode.tsx    // card + inline generate bar + typed ports
  nodes/VideoGeneratorNode.tsx
  nodes/PromptNode.tsx  VoiceNode.tsx  LLMAssistantNode.tsx
  nodes/StickyNoteNode.tsx  TextNode.tsx  SourceNode.tsx  OutputNode.tsx  FolderNode.tsx
  nodes/ports.ts                  // typed handle definitions + connection validation
  panels/NodeSettingsPanel.tsx    // right slide-in; Configure default, tucked Review/Provenance/Export tabs
  panels/ModelPicker.tsx          // searchable, Featured/All, families
  topbar/CanvasTopBar.tsx         // inline rename, Team Chat, Share
  landing/CanvasLanding.tsx       // board list + All Canvases/Templates tabs + gallery
```

**Node types.** Register a real `nodeTypes` map. Each generator node is a custom component with: title, typed input ports (image/video/audio/text as applicable), output port, optional asset preview, and an **inline generate bar** (prompt + model chip + batch stepper + Generate w/ credit cost from the registry). `toFlowNode` is rebuilt to set `type` to the real node type and pass structured data instead of JSX-in-label.

**Typed ports + edges.** Define per-type handles in `ports.ts`; validate connections by type; render bezier edges; allow an output to fan out to many inputs (reference fan-out).

**Settings panel.** Selecting a node animates in a right panel. Default **Configure** tab = the Higgsfield controls (Model picker, Aspect Ratio, Resolution/Quality or Duration/Generate-Audio, Batch Size, Generate). The **enterprise layer is tucked here** as additional tabs/sections — Review (brand/rights/approval pills + actions), Provenance (provider, model, cost, prompt-stored, synthetic-media), Exports (the existing adapters). Clean by default, full power one tab away.

**Toolbar / zoom rail / minimap.** Custom floating bottom toolbar and left zoom rail styled to Higgsfield; add an in-session `useGraphHistory` undo/redo stack (none exists today). Restyle the minimap.

**Top bar.** Inline-editable board title (writes through existing canvas update API); **Share** (reuses existing presence/visibility + a share link); **Team Chat** (entry point over existing comments/presence).

**Landing.** A dedicated landing view: board list + **All Canvases / Templates** tabs + a visual gallery built from the existing `workflowPresets` / templates API, each opening or cloning a starter graph (mirrors Higgsfield's "Long Video Example", "Image Edit", etc.).

**Theme.** `theme/tokens.ts` defines the dark palette, neon-lime accent, node glow, and dotted grid. Applied across the new components. The canvas goes **full-bleed** (drop the `max-w-7xl` dashboard frame).

### What stays unchanged (safety / YAGNI)

- Run engine, provider runtime, Higgsfield execution bridge, tenancy, approval governance, exporters, Firestore model — additive changes only.
- Client-portal vs admin gating from the foundation spec is preserved exactly; only appearance changes.
- We do not surface model names we cannot run.

## Phasing

- **Phase 1 — Foundation & theme.** Quarantine proof scaffolding; `theme/tokens.ts`; full-bleed shell; custom top bar; bottom toolbar; zoom rail + undo/redo; styled minimap; dotted background. No behaviour change to generation.
- **Phase 2 — Nodes & create menu.** `nodeTypes` map; custom generator node cards with typed ports + inline generate bars; bezier edges + reference fan-out; double/right-click searchable create menu; rebuilt `toFlowNode`.
- **Phase 3 — Model registry & settings panel.** `model-registry.ts`; searchable grouped `ModelPicker`; slide-in `NodeSettingsPanel` with Configure + tucked Review/Provenance/Export tabs.
- **Phase 4 — Inline generation.** `runs/generate` endpoint; wire `xai` synchronous image render; fast-poll/SSE for async; in-card asset rendering + credit cost.
- **Phase 5 — Landing & templates.** Landing view with tabs + template gallery + starter graphs.

Each phase ships independently and is verified in the browser preview before the next.

## Testing

- **Unit:** model-registry shape/lookup; port-type connection validation; `useGraphHistory` undo/redo; rebuilt `toFlowNode` mapping.
- **API:** `runs/generate` sync path (xai image renders + output node inserted); async fallback queues; tenancy + portal gating still block expensive runs; existing run/export tests still pass.
- **UI (preview tools):** create node via menu; inline generate bar renders an image; settings panel opens with correct controls per node kind; toolbar/zoom/undo-redo; landing tabs + open template; dark+lime theme present.
- **Build:** `NODE_OPTIONS=--max-old-space-size=8192 npm run build` after each phase (tsc alone misses server/client bundling boundaries).

## Non-goals (this delta)

- Full video timeline editor.
- Real credit deduction/balance enforcement (cost is displayed; metering remains as foundation spec).
- Replacing Social/Documents/Research/YouTube/Book modules.
- Listing third-party model names PiB cannot execute.

## Open recommendation for review

The ~40% "parity-proof / benchmark-evidence" scaffolding: recommend **quarantining to `lib/`** (keep it, out of the UI). If Peet would rather retire it entirely, that's a one-line decision that further simplifies Phase 1.

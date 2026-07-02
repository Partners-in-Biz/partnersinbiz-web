# Creative Canvas — Combine-Node Rework

Date: 2026-07-01 · Branch: development · Approach: rework in place, keep existing provider plumbing (Higgsfield API stays internally, name removed from UI).

## Goal

A freeform interactive canvas: drop media nodes (image / text / video), link any of them into a **Combine node**, write an instruction ("the person wears these clothes, dog sitting next to them"), choose output type (image / video), hit Generate → a new output node appears, itself linkable onward.

## Diagnosis (why it doesn't work today)

1. **Generate is silently gated.** `generateInlineForNode` returns without feedback unless a server-persisted canvas exists (`activeCanvas.id`), mode is `admin`, and a node with `data.canvasNode` is selected. `NodeSettingsPanel` disables the button on the same conditions (`CreativeCanvasWorkspace.tsx:6341`), and the in-node Generate button clicks no-op when `activeCanvas` is null (`:3971`). Net effect: button looks permanently dead. No error, no hint.
2. **Multi-node combine is impossible.** `nodes/ports.ts` gives `image_generator` exactly one image input; `isValidConnection` requires exact kind match (image→image only). You cannot wire person + clothes + dog into one generator.
3. **UX is buried.** `CreativeCanvasWorkspace.tsx` is ~7,400 lines, mostly proof/benchmark/certification machinery (visual proofs, benchmark URLs, world-class certification) that renders alongside the canvas. The source→brief→prompt→model→review→output pipeline model fights the freeform mental model.
4. **Higgsfield naming** leaks into UI copy, comments, and provider labels.

## Changes

### 1. Node model (components/creative-canvas/nodes/ports.ts + new CombineNode)
- New node type `combine`: unlimited inputs of any kind, instruction textarea, output-kind selector (image/video), model picker, Generate button on the node.
- Media nodes `image`, `text`, `video`: simple content nodes (upload / paste / pick from library), single output handle.
- Connection rule: any node output may connect into a combine input. Keep strict matching only for legacy generator nodes.

### 2. Generation flow (CreativeCanvasWorkspace)
- On Generate from a combine node: walk incoming edges; collect image URLs from upstream image/output nodes → `referenceImageUrls`; concatenate upstream text node content + the combine instruction → `prompt`; select model by chosen output kind; POST to existing `/api/v1/creative-canvas/[id]/runs/generate`.
- **Auto-persist:** if no `activeCanvas.id`, create/save the canvas transparently before running instead of silently refusing.
- On completion (sync or polled async), insert an output node wired from the combine node. Output nodes expose an image/video output handle so they can feed further combines.
- Every failure path surfaces a visible message (no more silent returns).

### 3. Cleanup
- Strip proof/benchmark/certification UI from the workspace render path; leave `lib/creative-canvas` proof modules untouched for now (dead-code removal later).
- Remove "Higgsfield" from all UI strings/labels; provider key stays `higgsfield` internally so API plumbing, callbacks, and cron keep working.
- Target: workspace component under ~1,500 lines after extraction.

### 4. Out of scope (this pass)
- Portal-mode generation, credits UI changes, collaboration/presence, versioning UX. They stay as-is.

## Verification
- Unit: port/connection rules, prompt+reference assembly from a linked graph.
- Manual: person+clothes+dog → combine → image; then that output + motion text → combine → video.
- Existing test suites for runs/inline-generation must stay green.

## Status (2026-07-01)

Implemented via file edits on `development` (sandbox shell was down, so NOT yet typechecked/tested/committed):

- `nodes/ports.ts` — new `combine` node type accepting image/video/audio/text inputs.
- `nodes/CombineNode.tsx` — new node card: linked-input previews, instruction textarea, image/video toggle, model button, Generate.
- `nodes/nodeTypes.ts`, `canvas/createMenuItems.ts`, `nodes/nodeData.ts` — registration + data fields.
- `CreativeCanvasWorkspace.tsx` — combine in presentation maps; `updateNodeOutputKind`; displayNodes now feed inputCount/inputPreviews + wire `onOpenModelPicker` (was a dead button); `generateInlineForNode` rewritten: graph-aware input collection (upstream images → referenceImageUrls, upstream text → prompt context), model resolved to the node's output kind, auto-creates/saves the canvas before running, every failure surfaces a message.
- `panels/NodeSettingsPanel.tsx` — model picker respects combine's output kind.
- UI copy: "Higgsfield" removed from workflow titles/labels on active surfaces.
- Test added: `__tests__/components/creative-canvas/ports.test.ts` combine ports.

## Status update (2026-07-02) — QA'd live, 6 more blockers found & fixed

Verified: typecheck clean, 258/258 creative-canvas tests green, pushed as
`60e280ec` (test copy updates) + `ae3e371d` (QA fixes) on origin/development.

Live-browser QA (localhost, admin session, canvas `2rlspEWvmW8oXBvuqYDS` in
org `pib-platform-owner`, person+clothes+dog → combine) surfaced these
previously invisible blockers, all fixed in `ae3e371d`:

1. **Firestore rejected undefined fields** in three write paths (canvas
   create `linked.projectId`, graph save `node.canvasId`, run create
   `input.operation`) → creating/saving/generating all 500'd. Fixed with
   `ignoreUndefinedProperties` on admin Firestore init + deep undefined-strip
   in the graph sanitizer + omit-empty `cleanLinked`.
2. **Create endpoint ignores nodes/edges** (`sanitizeCreativeCanvasInput`
   hardcodes `nodes: []`), and the old auto-persist applied that empty
   snapshot — wiping the user's local graph. Auto-persist now creates bare,
   then PUTs the graph, never clobbering local state.
3. **Edges never rendered.** `displayNodes` rebuilt each React Flow node from
   the backend node every render, discarding RF's measured dimensions —
   `nodesInitialized` stayed false and RF draws no edges. Now preserves the
   live node object. (This alone explains most of "the canvas doesn't work".)
4. **Persisted edges carry no handle ids**; nodes expose multiple typed
   handles, so RF couldn't attach edges. New `displayEdges` memo resolves
   source/target handles from port kinds.
5. **Immersive canvas had 0 height** — `h-full` chain collapses inside the
   app shell's auto-height wrapper; canvas was invisible below the tab bar.
   Now viewport-based `h-[calc(100dvh-72px)]`.
6. **referenceImageUrls were dropped server-side** (not in run-input
   whitelist, never read by the manifest) — linked images had zero effect on
   generation. Now validated + persisted on the run and emitted as `--image`
   flags in the Higgsfield execution manifest.

Also: model registry labels de-branded (`Soul 2.0`, family `Studio`);
combine/output port kind is a wildcard so outputs chain into any input.

E2E proof: Generate from the combine node → 201, run submitted to the Hermes
`pip` profile (VPS bridge), refs `[person, clothes, dog]` + instruction on
the run doc, status `running` via Hermes.

## Remaining
1. Strip the proof/benchmark/certification UI from the workspace component (~thousands of lines; compiler in the loop).
2. Confirm the async run completes and the output node lands + is chainable into a second combine (video). Runs were mid-flight at session close.
3. Simple media nodes (image/text/video) as first-class create-menu items — today images enter via source Upload/Assets; fine but two taps deeper than the Higgsfield-style mental model.

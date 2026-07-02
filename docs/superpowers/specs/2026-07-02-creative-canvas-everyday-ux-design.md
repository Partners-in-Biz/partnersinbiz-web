# Creative Canvas — Everyday UX (Phase 1) Design

Date: 2026-07-02 · Approved by Peet (chat) · Branch: development
Builds on: `docs/superpowers/plans/2026-07-01-creative-canvas-combine-rework.md`

## Goal

Make the canvas a tool Peet (and later clients) actually wants to live in:
obvious canvas management, direct node manipulation, an inline AI edit on any
node, one-tap media nodes, and a decluttered workspace. Publish loop and
creative suites (books/docs/websites) are Phases 2–3, out of scope here.

## Decisions (from brainstorm)

1. **Priority**: everyday canvas UX first.
2. **Inline AI edit**: per-edit **Branch / Replace** toggle (default Branch).
   Branch → result is a new node wired from the original. Replace → result
   takes the node's place; prior content survives in canvas version history.
3. **Suites**: canvas is the planning layer; Book Studio / client documents /
   project docs remain the systems of record (Phase 3).

## What already exists (do not rebuild)

- Canvas persistence, auto-save versions, landing (`CanvasLanding`) with
  boards + templates + `createBlankCanvas` — reachable via the unlabeled ⬓
  `onHome` button only.
- Node delete via Backspace (React Flow `onNodesChange` remove path).
- Source library (`lib/creative-canvas/source-library.ts`): uploads,
  workspace artifacts, research items, social posts, YouTube assets, Book
  Studio records.
- Run pipeline: `POST /api/v1/creative-canvas/[id]/runs/generate` with
  `referenceImageUrls`, Hermes dispatch, output node insertion
  (`${nodeId}-output`), combine flow (2026-07-02 fixes).
- Exporters for social draft / campaign asset / client document / blog /
  YouTube Studio / Book Studio / workspace artifact (Phase 2 will surface).

## Workstreams

### A. Canvas management, visible (CanvasTopBar + workspace)

- Replace ⬓ icon with a labeled **Canvases** button (same `onHome`).
- Add **+ New** button in the top bar → `createBlankCanvas()` and open it.
- Landing gains per-board **Rename** and **Delete** (confirm dialog; delete
  soft-deletes via existing canvas DELETE/PATCH API — verify; if missing, add
  `deleted: true` PATCH).
- Landing shows `updatedAt` and node count per board when available.

### B. Node toolbar (new `nodes/NodeToolbar.tsx` + workspace wiring)

Hover/selection toolbar on every node card: **Delete · Duplicate · Edit with
AI · Replace content · Download**.

- Delete → same path as Backspace (removes node + connected edges, records
  activity).
- Duplicate → existing duplicate flow (already in workspace).
- Replace content (source/media nodes) → opens the Assets/Upload picker in
  "swap" mode; chosen asset overwrites `node.source` (url/thumbnail/mime/alt),
  graph saved.
- Download → opens `node.output?.url ?? node.source?.url` in a new tab.
- Edit with AI → workstream C popover.

### C. Inline AI edit (new `nodes/NodeEditChat.tsx`)

Popover pinned to the node: prompt textarea, **Branch | Replace** segmented
toggle (default Branch), model auto-picked by node media kind, Generate.

- Image node → run with `referenceImageUrls: [nodeAssetUrl]`, prompt, image
  model. Video node → video model with reference. Text/prompt node → text
  generation path (`text_generation` provider / agent LLM), result becomes
  node text.
- Branch mode: reuse the existing output-node insertion; the new node is
  wired from the original (exactly like combine outputs).
- Replace mode: when the run's output lands, the client applies the output
  url/text onto the original node, removes the transient `${nodeId}-output`
  node, and saves the graph (a canvas version snapshot preserves the prior
  state). No server changes needed for v1.
- Failure surfaces on the popover (reuse activity message pattern).

### D. One-tap media nodes (createMenuItems + workspace)

Create menu top group becomes: **Image · Video · Audio · Text · Combine ·
Prompt · Generators…**. Image/Video/Audio create a source node preset to that
media kind and immediately open the Upload/Assets picker; Text creates the
existing text node focused for typing.

### E. Selection & tools (CanvasStage)

- Wire the existing BottomToolbar tools: select tool → `selectionOnDrag`
  (left-drag box-select, pan on middle/space); hand tool → pan on drag.
- Multi-select delete works via existing remove path.

### F. Declutter

- Strip proof/benchmark/certification UI from the workspace render path
  (already queued as a background task chip; lands with this phase). Target
  workspace component under ~1,500 lines. `lib/creative-canvas` proof modules
  stay for now.

## Error handling

Every user action surfaces failures via the existing `setActivityMessage`
pattern (no silent returns — same rule as the combine rework). Replace-mode
AI edits that fail leave the original node untouched.

## Testing

- Unit: node toolbar actions (delete/duplicate/replace wiring), edit-chat run
  assembly (branch vs replace payloads), create-menu media items, landing
  rename/delete.
- Existing suites must stay green (`__tests__/components/creative-canvas`,
  `__tests__/lib/creative-canvas`, run-route tests).
- Manual browser QA on localhost (same custom-token flow as 2026-07-02).

## Phases after this (recorded, not in scope)

- **Phase 2 — publish loop**: one-click export from output nodes to social
  drafts, campaign assets, client documents, org vault; save-back into
  campaigns.
- **Phase 3 — creative suites**: book boards (chapter/page/character nodes
  that evolve; exports to Book Studio), doc boards, website/app planning
  boards.

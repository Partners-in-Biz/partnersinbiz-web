# Hermes Desktop Messages Visual Redesign Spec

Last reviewed: 2026-07-09
Reference: Hermes Desktop screenshots supplied by Peet on 2026-07-09 and `docs/specs/hermes-desktop-messages-parity.md`.

## Problem

`/portal/messages` currently behaves more like a conventional portal chat than a Hermes Desktop-grade agent workspace. The page has too much card chrome, large padding, bulky conversation rows, a sparse permanent runtime inspector, and a composer/footer that feels like a form rather than a command line.

Hermes Desktop feels denser and more capable because it treats chat as an operating surface: a compact project/session rail, low-chrome transcript, searchable model menu, small icon language, and a thin bottom runtime/status bar.

## Design goals

1. Make `/portal/messages` feel like a dense Hermes-style workspace.
2. Keep the safe PiB runtime architecture: Firestore conversations + Hermes `/v1/runs` with sanitized model/provider metadata.
3. Move runtime controls toward a thin bottom command/status bar.
4. Make project/session navigation meaningfully denser than conversation cards.
5. Preserve role gates and never expose secrets, runtime URLs, local profile paths, provider credentials, or raw Hermes config.

## Screenshot-derived target

### Workspace shell

- Full-height message workspace with minimal outer padding.
- One continuous surface instead of multiple nested rounded cards.
- Compact top crumb/title strip, around 34-40px high.
- Main body split into:
  - project/session rail: 220-260px on desktop;
  - transcript canvas: flexible center;
  - runtime inspector: collapsed by default or narrow/optional right rail.

### Project/session rail

- Section headers use 10px uppercase tracking.
- Rows target 28-34px height when compact.
- Show a small dot/avatar, one-line title, and subtle secondary preview/time.
- Group conversations into useful sections:
  - Pinned;
  - Projects;
  - Agents;
  - Recent.
- Use local pinned/collapsed state for the first pass if server preferences are not ready.

### Transcript

- Reduce message gutters and avoid oversized card surfaces.
- Keep assistant content readable, but reduce the surrounding shell weight.
- Runtime/event details should be available without permanently consuming a large right card.

### Model picker

- Trigger should look like Hermes Desktop: compact chip text such as `GPT-5.5 · Max ▾`.
- Popover structure:
  - search field at top;
  - provider group labels such as `OPENAI`, `ANTHROPIC`, `OPENROUTER`;
  - dense rows with active checkmark on the right;
  - footer actions: `Refresh Models`, `Edit Models…`.
- Keep sanitized catalogue and `canSelect` role gates.
- Pinned/favorite models should be subtle, not visually dominant.

### Bottom runtime/control bar

Add a 24-32px strip below or integrated with the composer.

Left side:

- runtime/gateway health;
- active agent;
- queue count;
- latest run status;
- optional session timer.

Right side:

- compact model picker;
- effort selector;
- approval mode indicator;
- mic/dictation;
- read/mute control where applicable;
- stop/run button.

### YOLO / approval policy

Do not ship a fake YOLO toggle. Initial state should be:

- `Ask` enabled by default;
- `YOLO` disabled unless backed by server-side run approval policy and strict role gates;
- tooltip copy: `YOLO requires admin run policy support`.

### Mobile/tablet

- No bulky permanent side cards.
- Session/project navigation becomes a horizontal strip.
- Inspector opens as a bottom sheet/drawer.
- Bottom runtime bar compresses to icon + selected model + run status.
- Keep top/subnav padding minimal so chat gets the screen real estate.

## Implementation scope

### First redesign slice

1. Add a dedicated Hermes-style Messages shell component.
2. Add a `layoutVariant="hermes"` path to `UnifiedChat` without changing default embedded chat behavior.
3. Compact the conversation list/rail for `/portal/messages`.
4. Polish `ModelProviderPicker` into a grouped Desktop-style menu.
5. Add a bottom runtime bar with safe, real controls and disabled future controls where needed.
6. Collapse the runtime inspector by default or make it optional.

### Later slices

- Server-backed user/org runtime preferences.
- True project metadata in conversation summaries.
- Admin-only Hermes live-session mode if PiB intentionally adopts `session.steer` semantics.
- Server-backed YOLO/approval policy if approved.

## Non-goals

- Do not expose Hermes raw runtime URLs, dashboard tokens, provider credentials, local paths, or raw config.
- Do not fake Desktop `session.steer`; queued next-turn prompts are not live steering.
- Do not enable YOLO without backend policy enforcement.
- Do not restyle every embedded `UnifiedChat` consumer at once.
- Do not promote to production without explicit approval and browser smoke.

## Acceptance criteria

- `/portal/messages` uses a Hermes-style shell, not a generic bento/card page.
- Conversation/project navigation is denser and grouped.
- Composer is closer to a command line than a form footer.
- Bottom runtime/control bar is visible and useful.
- Model picker visually resembles Hermes Desktop and remains sanitized/role-gated.
- Runtime inspector can collapse or move to drawer mode.
- Mobile layout preserves screen real estate.
- Focused tests, typecheck, lint ratchet, diff check, lint, parity monitor, and build pass.
- Manual browser smoke is completed before calling the redesign production-ready.

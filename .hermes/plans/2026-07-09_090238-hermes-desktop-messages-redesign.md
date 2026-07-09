# Hermes Desktop Messages Redesign Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild `/portal/messages` so it feels like a dense Hermes Desktop-grade agent workspace rather than a conventional card-based client portal chat.

**Architecture:** Keep the already-safe Hermes run/model/provider backend plumbing. Redesign the Messages frontend in layers: first stabilize the current composer bridge, then introduce a Hermes-style workspace shell, compact model picker, bottom status/control bar, project/session navigation, and collapsible inspector. Avoid faking Desktop-only runtime semantics such as true `session.steer` or unrestricted YOLO; every dangerous control must be backed by a real server policy and role gate.

**Tech Stack:** Next.js App Router, React client components, Tailwind utility classes, existing PiB CSS variables, Firebase-authenticated portal APIs, existing Hermes `/v1/runs` integration, Jest/React Testing Library, optional browser smoke via Hermes browser tools.

---

## Current Context

### What Peet is reacting to

The screenshots show a clear quality gap:

- **Hermes Desktop** feels like a workstation: dense left project/session sidebar, low-chrome transcript surface, compact message stream, small icons, a polished grouped model picker, and a thin bottom status/control bar.
- **PiB Messages** currently feels like a normal web-app card layout: large portal chrome, bulky conversation cards, a big bordered chat card, a sparse right runtime inspector card, a large composer/send button area, and no unified bottom runtime/status strip.

Peet specifically likes these Hermes Desktop qualities:

- Compact project/session sidebar with nested projects and sessions.
- Smaller icons and lower visual weight.
- Model picker with searchable grouped models, active checkmark, refresh/edit footer actions, and compact menu density.
- Thin bottom info/control bar where model, voice/mute, run/stop, gateway/agent/cron-style statuses, session state, and YOLO-like controls live.
- Less padding and less card chrome.

### Current PiB Messages state

Relevant files:

- `app/(portal)/portal/messages/page.tsx`
  - Loads portal auth/org/capabilities and renders `MessagesWorkspace`.
- `components/messages/MessagesWorkspace.tsx`
  - Owns the top-level Messages workspace and currently just wraps `UnifiedChat`.
- `components/chat/UnifiedChat.tsx`
  - Owns too much: conversation list, message stream, context refs, slash commands, composer, send/finalize/event flow, model picker wiring, and runtime inspector wiring.
- `components/chat/ConversationListItem.tsx`
  - Bulky conversation row compared with Hermes Desktop sessions.
- `components/messages/hermes/ModelProviderPicker.tsx`
  - Safe model picker exists, but its menu is heavier and less Desktop-like than Hermes.
- `components/messages/hermes/RuntimeInspectorRail.tsx`
  - Useful data, but currently occupies a full sparse right card.
- `components/chat/VoiceInputButton.tsx`
  - Voice dictation exists.
- `components/chat/MessageBubble.tsx`
  - Message rendering, including read-aloud work from the current parity slice.

### Current dirty work before this plan

At plan creation time the repo has uncommitted changes in:

- `components/chat/UnifiedChat.tsx`
- `__tests__/components/chat/UnifiedChat.context.test.tsx`
- `app/og/default.png/route.tsx`

These are from the previous small bridge pass:

- local composer history / queued follow-up behavior;
- test cleanup for React `act()` warnings;
- removing incompatible `dynamic = 'force-static'` from the Edge OG route.

**Decision before implementation:** either finish/verify/commit that bridge as a separate small commit, or revert it and re-implement those behaviors inside the redesign. Do not mix an unreviewed bridge patch with the large visual redesign commit.

---

## Product Principles

1. **Hermes-like density, not generic SaaS cards**
   - Use low padding, thin borders, translucent dark surfaces, and small icon buttons.
   - The chat workspace should look like an operating surface, not a marketing dashboard card.

2. **One workspace surface**
   - Conversation list, transcript, runtime controls, and inspector should feel like one continuous app shell.
   - Avoid nested rounded cards inside rounded cards.

3. **Bottom controls are the command center**
   - Model, effort, approval/YOLO mode, queue count, voice/mute/read-aloud, stop/run state, and runtime health belong in a thin bottom bar.

4. **Safe parity over fake parity**
   - If Hermes Desktop has a control that PiB cannot safely back yet, show it disabled with an honest tooltip or hide it by role.
   - Do not fake true `session.steer` unless PiB integrates real Hermes live-session semantics.

5. **Role gates remain non-negotiable**
   - Admin/AI-authorized users can select runtime options.
   - Client/read-only users can inspect only safe status.
   - YOLO/approval bypass must be role-gated and server-validated if implemented.

---

## Proposed UX Target

### Desktop layout

Use a Hermes-style 4-zone layout:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  compact top crumb / workspace title                                icons  │  34-40px
├───────────────┬───────────────────────────────────────────────┬─────────────┤
│ Project/      │ Transcript                                    │ Inspector   │
│ session rail  │                                               │ drawer/rail │
│ 220-260px     │ low-card message stream                       │ 0/280px     │
│ dense rows    │                                               │ collapsible │
├───────────────┴───────────────────────────────────────────────┴─────────────┤
│ +  composer input                                 model ▾ mic mute run/stop │
├─────────────────────────────────────────────────────────────────────────────┤
│ Gateway/Runtime • Agent • Cron/Queue • Approval: Ask/YOLO • Session timer   │  24-28px
└─────────────────────────────────────────────────────────────────────────────┘
```

### Mobile/tablet layout

- No full-height side cards.
- Use a compact horizontal session/project strip above the transcript.
- Inspector becomes a bottom sheet/drawer.
- Bottom status bar remains, but wraps to two rows if needed.

---

## Implementation Plan

### Task 0: Resolve the current bridge patch before redesign

**Objective:** Start the redesign from a clean, intentional base.

**Files:**
- Current dirty: `components/chat/UnifiedChat.tsx`
- Current dirty: `__tests__/components/chat/UnifiedChat.context.test.tsx`
- Current dirty: `app/og/default.png/route.tsx`

**Steps:**

1. Inspect current diff:
   ```bash
   git diff --stat
   git diff -- components/chat/UnifiedChat.tsx __tests__/components/chat/UnifiedChat.context.test.tsx app/og/default.png/route.tsx
   ```

2. Choose one:
   - **Preferred:** finish the bridge patch as a separate commit:
     ```bash
     npm test -- --runInBand __tests__/components/chat/UnifiedChat.context.test.tsx
     npm run typecheck
     npm run lint:ratchet
     git diff --check
     git add components/chat/UnifiedChat.tsx __tests__/components/chat/UnifiedChat.context.test.tsx app/og/default.png/route.tsx
     git commit -m "feat(messages): add local composer queue and history"
     ```
   - Or revert it before the redesign:
     ```bash
     git checkout -- components/chat/UnifiedChat.tsx __tests__/components/chat/UnifiedChat.context.test.tsx app/og/default.png/route.tsx
     ```

3. Confirm clean base:
   ```bash
   git status --short --branch
   ```

**Expected:** clean `development` branch before Task 1.

---

### Task 1: Create a Hermes Messages UX spec in-tree

**Objective:** Turn the screenshots and critique into an executable UI spec that future agents cannot dilute.

**Files:**
- Create: `docs/specs/hermes-desktop-messages-visual-redesign.md`
- Modify: `docs/specs/hermes-desktop-messages-parity.md`

**Spec must include:**

- Screenshot-derived design targets:
  - left rail density;
  - bottom status/control bar;
  - compact model picker;
  - thin icon language;
  - inspector collapse behavior;
  - mobile project/session strip.
- Explicit non-goals:
  - no fake `session.steer`;
  - no unvalidated YOLO;
  - no exposing raw Hermes runtime URLs/secrets.
- Acceptance criteria:
  - chat chrome uses less vertical/horizontal padding;
  - model picker resembles Desktop menu structure;
  - bottom bar exists and controls runtime-facing UI;
  - inspector can collapse;
  - project/session navigation is denser than current conversation cards.

**Verification:** doc exists and is linked from `docs/specs/hermes-desktop-messages-parity.md`.

---

### Task 2: Add a dedicated Hermes-style Messages shell component

**Objective:** Stop treating `UnifiedChat` as the only layout owner.

**Files:**
- Create: `components/messages/hermes-desktop/HermesMessagesShell.tsx`
- Create: `components/messages/hermes-desktop/types.ts`
- Modify: `components/messages/MessagesWorkspace.tsx`
- Test: `__tests__/components/messages/HermesMessagesShell.test.tsx`

**Design:**

`MessagesWorkspace` should choose the shell:

```tsx
<HermesMessagesShell
  surface={surface}
  orgId={orgId}
  orgName={orgName}
  currentUserUid={currentUserUid}
  currentUserDisplayName={currentUserDisplayName}
  userRole={userRole}
  capabilities={{
    allowStartConversations,
    allowSendMessages,
    allowAgentParticipants: allowAgentParticipants ?? (isAdmin || userRole === 'admin'),
    allowArchiveConversations,
  }}
  initialConvId={initialConvId}
/>
```

`HermesMessagesShell` initially renders `UnifiedChat` inside a denser shell. It should not yet duplicate send logic.

**Acceptance:**

- `MessagesWorkspace` no longer owns visual chrome beyond choosing admin run session vs messages shell.
- The new shell has regions for:
  - project/session rail;
  - transcript panel;
  - collapsible inspector;
  - bottom runtime bar.

---

### Task 3: Add `layoutVariant="hermes"` to `UnifiedChat`

**Objective:** Enable dense styling without rewriting message/run logic.

**Files:**
- Modify: `components/chat/UnifiedChat.tsx`
- Modify: callers if needed:
  - `components/messages/hermes-desktop/HermesMessagesShell.tsx`
  - `components/chat/MessageDrawer.tsx`
  - `components/projects/ProjectDetailWorkspace.tsx`
  - `components/briefing/cockpit/DockedChat.tsx`
- Test: `__tests__/components/chat/UnifiedChat.context.test.tsx`

**Implementation:**

Add props:

```ts
layoutVariant?: 'classic' | 'hermes'
inspectorMode?: 'rail' | 'drawer' | 'hidden'
conversationListDensity?: 'comfortable' | 'compact'
```

Rules:

- Default remains `classic` so embedded chat surfaces do not unexpectedly change.
- `/portal/messages` passes `layoutVariant="hermes"`.
- `hermes` variant reduces:
  - outer panel radius/chrome;
  - composer padding;
  - message gutters;
  - conversation row height;
  - icon sizes to 14-18px where possible.

**Acceptance:** existing tests pass; classic consumers do not visually regress.

---

### Task 4: Redesign the project/session rail

**Objective:** Replace the bulky conversation card list with a Hermes-like project/session navigator.

**Files:**
- Create: `components/messages/hermes-desktop/ProjectSessionRail.tsx`
- Modify: `components/chat/ConversationListItem.tsx` or create `components/messages/hermes-desktop/SessionRow.tsx`
- Modify: `components/chat/UnifiedChat.tsx` to support compact row renderer or external rail slot.
- Test: `__tests__/components/messages/ProjectSessionRail.test.tsx`

**Data model:**

Use existing conversation fields first:

- `scope`
- `scopeRefId`
- `contextRefs`
- `participantAgentIds`
- `lastMessageAt`
- `archived`

Group conversations into sections:

1. `Pinned` — localStorage pinned conversations for this org.
2. `Projects` — conversations with `scope === 'project'` or project-like `contextRefs`.
3. `Agents` — active agent conversations grouped by primary agent.
4. `Recent` — fallback.

**UI target:**

- 220-260px width desktop.
- Section headers in 10px uppercase tracking.
- Rows at ~28-34px high where possible.
- Small dot/avatar, single-line title, subtle secondary preview/time.
- No large participant-chip block by default.
- Hover and active states similar to Hermes Desktop: thin highlight, low-contrast surface.

**Acceptance:** more conversations fit vertically than current card list by at least ~35%.

---

### Task 5: Build the compact Hermes-style model picker

**Objective:** Make PiB model selection feel like Hermes Desktop, while preserving sanitized catalogue and role gates.

**Files:**
- Modify or split: `components/messages/hermes/ModelProviderPicker.tsx`
- Optional create: `components/messages/hermes-desktop/CompactModelMenu.tsx`
- Test: `__tests__/components/messages/ModelProviderPicker.test.tsx`

**UI changes:**

- Trigger becomes a low-height text chip in the composer/status area:
  - `GPT-5.5 · Max ▾` style, not a full button/card.
- Popover should match Desktop structure:
  - search field at top;
  - provider group labels (`OPENAI`, `ANTHROPIC`, etc.);
  - model rows with active checkmark on the right;
  - footer actions: `Refresh Models`, `Edit Models…`.
- Keep pinning, but make it subtle:
  - star appears on hover or as small left icon.
- Preserve disabled/read-only role behavior.

**Acceptance:** picker can be used from the bottom bar and has no raw runtime/secret data.

---

### Task 6: Add the thin bottom runtime/control bar

**Objective:** Move runtime controls into a Desktop-like bottom info strip.

**Files:**
- Create: `components/messages/hermes-desktop/BottomRuntimeBar.tsx`
- Modify: `components/chat/UnifiedChat.tsx` to expose needed state or render bottom slot.
- Test: `__tests__/components/messages/BottomRuntimeBar.test.tsx`

**Controls:**

Left side:

- gateway/runtime health chip, e.g. `Runtime ready`;
- active agent chip, e.g. `Pip`;
- queue count, e.g. `Queue 2`;
- latest run status, e.g. `running`, `waiting approval`, `completed`.

Right side:

- model picker trigger;
- effort selector (`Auto`, `Low`, `Med`, `High`, `Max`);
- approval mode chip:
  - `Ask` by default;
  - `YOLO` only if role-gated and server-backed;
  - disabled with tooltip if backend policy is not available yet.
- mic/dictation button;
- read/mute toggle if applicable;
- stop/run button.

**Safety rule for YOLO:**

Do not implement YOLO as a purely local boolean. It must either:

1. map to an existing server-validated run approval policy, or
2. render disabled with text: `YOLO requires admin run policy support`.

**Acceptance:** the composer body becomes visually smaller because controls move to the bottom strip.

---

### Task 7: Redesign the composer

**Objective:** Match Hermes Desktop’s low-profile composer.

**Files:**
- Modify: `components/chat/UnifiedChat.tsx`
- Modify: `components/chat/VoiceInputButton.tsx` if icon sizing needs a compact variant.
- Test: `__tests__/components/chat/UnifiedChat.context.test.tsx`

**Changes:**

- Input height target: 38-44px for empty composer.
- Attach button: small `+` icon at left inside the composer row.
- Placeholder should feel command-oriented:
  - `What's next?` for agent conversations;
  - `Send a message` for ordinary client conversations.
- Send button becomes circular icon-only run/stop button where possible.
- Queue behavior visible as a small chip, not a big panel.
- Context chips should collapse into a compact overflow row when many are attached.

**Acceptance:** composer no longer looks like a form footer; it looks like a command line.

---

### Task 8: Collapse the Runtime Inspector into drawer/mini rail

**Objective:** Keep runtime transparency without wasting a permanent 280px sparse card.

**Files:**
- Modify: `components/messages/hermes/RuntimeInspectorRail.tsx`
- Create: `components/messages/hermes-desktop/RuntimeInspectorDrawer.tsx`
- Modify: `components/chat/UnifiedChat.tsx`
- Test: `__tests__/components/messages/RuntimeInspectorRail.test.tsx`

**Desktop behavior:**

- Default: hidden/collapsed icon in top or bottom bar.
- Expanded: right rail slides open at 280-320px.
- Latest run summary appears in bottom bar even when rail is closed.

**Mobile behavior:**

- Inspector opens as bottom sheet.

**Acceptance:** users can still copy run ID, stop run, inspect live events, but the normal workspace is not dominated by the inspector.

---

### Task 9: Add project/session affordances beyond conversations

**Objective:** Make PiB Messages feel like a project workspace, not just an inbox.

**Files:**
- Create: `components/messages/hermes-desktop/ProjectRailSection.tsx`
- Modify: conversation loading/grouping logic in `components/chat/UnifiedChat.tsx` or extracted hook.
- Optional API follow-up: `app/api/v1/conversations/route.ts` if project metadata is missing.
- Test: new grouping unit tests.

**First pass without backend changes:**

- Derive project groups from:
  - conversation `scope` / `scopeRefId`;
  - `contextRefs` with project-like types;
  - title prefixes when needed as fallback.
- Add local pinned conversations:
  - storage key: `pib.messages.pinnedConversations.v1:<orgId>`.
- Add section collapse state:
  - storage key: `pib.messages.railSections.v1:<orgId>`.

**Second pass with backend if needed:**

- Add explicit project metadata to conversation summaries.
- Add server-side pinned/starred conversations per user.

**Acceptance:** rail shows meaningful `Projects`, `Pinned`, and `Recent` sections.

---

### Task 10: Mobile and responsive polish

**Objective:** Avoid repeating the current “too much padding, lost real estate” issue on mobile.

**Files:**
- Modify: `components/messages/hermes-desktop/HermesMessagesShell.tsx`
- Modify: `components/messages/hermes-desktop/ProjectSessionRail.tsx`
- Modify: `components/messages/hermes-desktop/BottomRuntimeBar.tsx`
- Test: component tests for responsive class presence; browser smoke for actual viewport.

**Mobile target:**

- No bulky portal header on Messages.
- Horizontal project/session chips above transcript.
- Composer pinned to bottom.
- Runtime/status bar compresses to icons + selected model.
- Inspector opens as sheet.

**Verification:** browser smoke at:

- desktop: 1920×1080;
- laptop: 1440×900;
- tablet-ish: 1024×768;
- mobile: 390×844.

---

### Task 11: Testing and verification gates

**Objective:** Make the redesign safe to ship.

**Commands:**

```bash
npm test -- --runInBand \
  __tests__/components/chat/UnifiedChat.context.test.tsx \
  __tests__/components/messages/ModelProviderPicker.test.tsx \
  __tests__/components/messages/RuntimeInspectorRail.test.tsx \
  __tests__/api/messages-model-catalog.test.ts \
  __tests__/api/conversation-messages-routing.test.ts \
  __tests__/api/hermes-run-lifecycle.test.ts

npm run check:hermes-desktop-parity
npm run typecheck
npm run lint:ratchet
git diff --check
npm run lint
npm run build
```

**Manual browser smoke:**

- Open `/portal/messages` on local dev or a preview build.
- Confirm:
  - dense rail sections render;
  - model picker opens/searches/selects without secrets;
  - bottom runtime bar shows model/effort/status;
  - composer sends normal messages;
  - active run can be stopped where allowed;
  - queued prompt/history works if retained;
  - inspector opens/collapses;
  - mobile layout does not waste top/subnav space.

---

## Suggested Parallel Execution with Subagents

Use parallel read-only/review subagents at the start of each phase:

1. **Design subagent**
   - Compare screenshots to current components.
   - Return exact spacing/density/icon recommendations.

2. **Architecture subagent**
   - Identify safest extraction seams in `UnifiedChat.tsx`.
   - Ensure state/send/finalize/runtime semantics are not broken.

3. **Testing subagent**
   - Propose Jest/RTL assertions for each new component and smoke checklist.

Implementation should still happen in the main agent context or one task at a time with review, because multiple writers touching `UnifiedChat.tsx` will conflict.

---

## Risks and Guardrails

1. **`UnifiedChat.tsx` is already too large**
   - Do not perform a giant rewrite.
   - Add layout variant and shell pieces first; extract hooks later.

2. **YOLO is security-sensitive**
   - Do not ship an enabled YOLO toggle unless server policy supports it.
   - First implementation may show `Ask` active and `YOLO` disabled for transparency.

3. **Client-facing safety**
   - No runtime URLs, dashboard tokens, provider credentials, local paths, or raw provider configs in any client response or UI.

4. **Portal-wide layout regressions**
   - Keep the Hermes redesign scoped to `/portal/messages` first.
   - Do not accidentally restyle CRM, email, projects, cockpit, or embedded chat surfaces.

5. **Visual quality cannot be proven by unit tests alone**
   - Browser smoke and screenshot review are mandatory before claiming “world-class”.

---

## Recommended Commit Slices

1. `feat(messages): add Hermes desktop visual spec`
2. `feat(messages): add Hermes-style messages shell`
3. `feat(messages): compact conversation project rail`
4. `feat(messages): polish desktop model picker`
5. `feat(messages): add bottom runtime control bar`
6. `feat(messages): collapse runtime inspector`
7. `test(messages): cover Hermes desktop layout states`
8. `docs(partners): document Messages redesign rollout`

Do not use `[vercel-build]` or `[preview-build]` unless Peet explicitly wants a Vercel Preview build triggered.

---

## Definition of Done

The redesign is not done until all of these are true:

- `/portal/messages` visually matches the Hermes Desktop direction: dense, compact, workspace-like.
- The model picker is compact, grouped, searchable, and role-safe.
- A thin bottom runtime/control bar exists.
- The runtime inspector no longer wastes permanent space by default.
- Project/session navigation is meaningfully better than the current conversation-card list.
- Mobile layout is explicitly checked and does not lose real estate to padding/subnav.
- Unit/focused tests pass.
- Typecheck, lint ratchet, diff check, lint, parity monitor, and build pass.
- Manual browser smoke is completed.
- Work is committed and pushed to `origin/development`.
- Partners wiki/hot/session log are updated with the design decision and rollout state.

---

## Open Questions for Peet

These do not block starting Tasks 0-5, but should be decided before enabling advanced controls:

1. Should `/portal/messages` fully replace the current layout for everyone, or should we ship a temporary `?layout=hermes` preview first?
2. Should clients see model/runtime controls, or only admins/AI-authorized users?
3. What should YOLO mean in PiB?
   - auto-approve low-risk tools only;
   - auto-approve all non-sensitive agent actions;
   - or just a future disabled affordance until policy is built?
4. Should project/session grouping come from existing PiB Projects/Kanban data, or remain conversation-derived for the first pass?
5. Should Runtime Inspector be admin-only by default, with clients seeing only friendly agent status?

# Hermes Desktop Messages Parity Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild Partners in Biz `/portal/messages` into a Hermes Desktop-style Message Command Center with minimal layout, model/provider selection, pinned models, runtime controls, rich Hermes run feedback, and role-safe provider settings.

**Architecture:** Preserve the existing PiB conversation/Hermes backend and decompose the front-end into a Hermes-like shell. Add a sanitized model catalogue API and per-turn model/provider overrides before adding admin-only provider settings. Keep all credentials and raw Hermes control-plane details server-side.

**Tech Stack:** Next.js App Router, React/TypeScript, Firebase/Firestore, existing PiB Hermes gateway integration, Tailwind-style utility classes, Jest/RTL.

---

## Current context / assumptions

- Current route entry is `app/(portal)/portal/messages/page.tsx`, which resolves auth/org/module policy then renders `MessagesWorkspace`.
- Current UI core is `components/chat/UnifiedChat.tsx`, a large component that already handles conversations, context refs, slash commands, attachments, voice, SSE events, Hermes finalization polling, approvals, actions, stop, and the composer.
- Current Hermes run path is `app/api/v1/conversations/[convId]/messages/route.ts` → `createHermesRun()` in `lib/hermes/server.ts`.
- `HermesRunRequest` already supports `model` and `provider`; the message route just does not accept/validate/pass them yet.
- Existing admin controls in `lib/hermes/server.ts` already allowlist models/model/config/tools/skills/sessions/logs/env/profile/profiles/cron, but there is no polished Messages model/provider UX.
- The implementation must never expose API keys, dashboard session tokens, raw profile paths, or local Hermes URLs to client browsers.

---

## Task 1: Add characterization tests for current chat send/runtime behaviour

**Objective:** Freeze the current behaviour before decomposing `UnifiedChat`.

**Files:**
- Modify: `__tests__/components/chat/UnifiedChat.context.test.tsx`
- Modify or add: `__tests__/api/conversation-messages-routing.test.ts`

**Steps:**
1. Add/extend tests proving the current composer can send plain text, slash command payloads, context refs, and `agentEffort`.
2. Add/extend API tests proving `/api/v1/conversations/[convId]/messages` stores the user message, creates a pending assistant message, dispatches Hermes, and stores returned `runId`.
3. Run:
   ```bash
   npm test -- --runInBand __tests__/components/chat/UnifiedChat.context.test.tsx __tests__/api/conversation-messages-routing.test.ts
   ```
4. Expected: all current assertions pass before refactor.

---

## Task 2: Decompose `UnifiedChat` shell with no feature changes

**Objective:** Extract visual subcomponents while keeping state/controller logic in `UnifiedChat` initially.

**Files:**
- Create: `components/messages/hermes/HermesMessagesShell.tsx`
- Create: `components/messages/hermes/MessageCommandSidebar.tsx`
- Create: `components/messages/hermes/MessageThreadHeader.tsx`
- Create: `components/messages/hermes/MessageThreadPane.tsx`
- Create: `components/messages/hermes/MessageComposerBar.tsx`
- Modify: `components/chat/UnifiedChat.tsx`

**Steps:**
1. Extract the left conversation list (`UnifiedChat.tsx:1435-1527`) into `MessageCommandSidebar`.
2. Extract active conversation header (`UnifiedChat.tsx:1583-1694`) into `MessageThreadHeader`.
3. Extract message log (`UnifiedChat.tsx:1696-1787`) into `MessageThreadPane`.
4. Extract composer (`UnifiedChat.tsx:1796-2079`) into `MessageComposerBar`.
5. Keep callbacks/state in `UnifiedChat` and pass props down.
6. Run current focused tests and typecheck:
   ```bash
   npm test -- --runInBand __tests__/components/chat/UnifiedChat.context.test.tsx __tests__/components/chat/MessageBubble.test.tsx
   npm run typecheck
   ```
7. Expected: no behaviour change.

---

## Task 3: Apply Hermes-style minimal layout

**Objective:** Make `/portal/messages` feel like Hermes Desktop: clean rail, top bar, central stream, pinned bottom composer, optional right rail placeholder.

**Files:**
- Modify: `components/messages/MessagesWorkspace.tsx`
- Modify: `components/messages/hermes/HermesMessagesShell.tsx`
- Modify: `components/messages/hermes/MessageCommandSidebar.tsx`
- Modify: `components/messages/hermes/MessageThreadHeader.tsx`
- Modify: `components/messages/hermes/MessageComposerBar.tsx`

**Steps:**
1. Replace the current card-heavy intro/header with a compact shell: left rail, center thread, optional right rail.
2. Keep current mobile list/thread switching.
3. Add a collapsed left-rail state and dense conversation rows.
4. Add top-bar chips for agent, model placeholder, runtime status placeholder.
5. Run component tests plus browser smoke locally.

---

## Task 4: Add sanitized model catalogue API

**Objective:** Provide model/provider data to the browser without credentials or raw Hermes config.

**Files:**
- Create: `app/api/v1/conversations/[convId]/models/route.ts`
- Or create: `app/api/v1/orgs/[orgId]/messages/models/route.ts`
- Modify: `lib/hermes/server.ts` if helper extraction is needed
- Modify: `lib/hermes/types.ts` for safe public model types
- Add: `__tests__/api/messages-model-catalog.test.ts`

**Steps:**
1. Define a safe response type with `provider`, `providerLabel`, `model`, `displayName`, `configured`, `active`, `available`, `supportsThinking?`, `supportsVision?`, `supportsTools?`, `reasonUnavailable?`.
2. Resolve selected agent/runtime from the conversation or query param.
3. Call Hermes model/config controls server-side through existing allowlisted helpers.
4. Strip all credentials and local endpoint details.
5. Add tests proving secrets/tokens/base URLs are absent from the response.
6. Run:
   ```bash
   npm test -- --runInBand __tests__/api/messages-model-catalog.test.ts __tests__/api/hermes-admin-controls.test.ts
   npm run typecheck
   ```

---

## Task 5: Build `ModelProviderPicker`

**Objective:** Add Hermes Desktop-style model selection UI using the sanitized catalogue.

**Files:**
- Create: `components/messages/hermes/ModelProviderPicker.tsx`
- Create: `components/messages/hermes/PinnedModelStrip.tsx`
- Add: `__tests__/components/messages/ModelProviderPicker.test.tsx`
- Modify: `components/messages/hermes/MessageThreadHeader.tsx`
- Modify: `components/messages/hermes/MessageComposerBar.tsx`

**Steps:**
1. Show active model/provider as a compact button in header/composer.
2. On click, open a popover with search, provider groups, active/current state, unavailable reasons, and pinned models.
3. Add star/unstar UI; initially keep persistence in localStorage for quick parity.
4. Hide or degrade the picker for client roles if policy says model selection is disabled.
5. Run component tests and typecheck.

---

## Task 6: Persist user/org pinned model preferences

**Objective:** Move from local-only pins to PiB user/org-aware persistence.

**Files:**
- Create: `app/api/v1/orgs/[orgId]/messages/model-preferences/route.ts`
- Create or modify: `lib/messages/model-preferences.ts`
- Modify: `components/messages/hermes/PinnedModelStrip.tsx`
- Add: `__tests__/api/messages-model-preferences.test.ts`

**Steps:**
1. Store per-user/per-org preferences such as `pinnedModelsByAgent`, `lastSelectedModelByAgent`, and `lastReasoningEffortByAgent`.
2. Enforce caller can access the org.
3. Ensure preferences store only model IDs/provider IDs, not credentials.
4. Run focused API tests and typecheck.

---

## Task 7: Add per-turn model/provider override to send path

**Objective:** Actually route a selected model/provider into Hermes run creation.

**Files:**
- Modify: `components/messages/hermes/MessageComposerBar.tsx`
- Modify: `components/chat/UnifiedChat.tsx`
- Modify: `app/api/v1/conversations/[convId]/messages/route.ts`
- Modify: `lib/conversations/types.ts`
- Add: `__tests__/api/conversation-messages-model-overrides.test.ts`

**Steps:**
1. Add `selectedModel` and `selectedProvider` to the composer state.
2. Include `{ model, provider }` in the `POST /messages` body.
3. Validate model/provider against the sanitized catalogue and org/role policy.
4. Pass `model` and `provider` to `createHermesRun` alongside `reasoning_effort`.
5. Persist selected runtime fields in message metadata and `hermes_runs.metadata`.
6. Add tests proving valid overrides are passed and invalid/unauthorized overrides are rejected.
7. Run:
   ```bash
   npm test -- --runInBand __tests__/api/conversation-messages-model-overrides.test.ts __tests__/api/conversation-messages-routing.test.ts
   npm run typecheck
   ```

---

## Task 8: Add conversation runtime defaults

**Objective:** Let a conversation remember selected agent/model/provider/reasoning defaults.

**Files:**
- Create: `app/api/v1/conversations/[convId]/runtime/route.ts`
- Modify: `lib/conversations/types.ts`
- Modify: `lib/conversations/conversations.ts`
- Modify: `components/chat/UnifiedChat.tsx`
- Add: `__tests__/api/conversation-runtime-defaults.test.ts`

**Steps:**
1. Add optional `runtimeDefaults` to conversation type.
2. Add PATCH route with role/policy validation.
3. Load defaults into the composer when a conversation is selected.
4. Store changes when user chooses “Use for this conversation”.
5. Run focused tests and typecheck.

---

## Task 9: Add `RuntimeInspectorRail`

**Objective:** Move live run status/events into a Hermes-like right rail.

**Files:**
- Create: `components/messages/hermes/RuntimeInspectorRail.tsx`
- Modify: `components/messages/hermes/HermesMessagesShell.tsx`
- Modify: `components/chat/UnifiedChat.tsx`
- Add: `__tests__/components/messages/RuntimeInspectorRail.test.tsx`

**Steps:**
1. Feed `liveEvents`, active message status, `runId`, `dispatchAgentId`, selected model/provider, and finalizer state to the rail.
2. Render a compact timeline of `assistant.text_delta`, tool/status/rich events, approval waiting, completion/failure.
3. Add copy run id, open admin run session, retry, and stop actions where role policy allows.
4. Run component tests and existing finalizer/action tests.

---

## Task 10: Add admin-only provider settings cards

**Objective:** Give Peet/operator users Hermes Desktop-style provider management without exposing raw dashboard screens.

**Files:**
- Create or modify: `components/admin/hermes/ProviderSettingsCards.tsx`
- Possibly create: `app/(admin)/admin/hermes/providers/page.tsx`
- Modify or reuse: `app/api/v1/admin/hermes/profiles/[orgId]/controls/[control]/[[...path]]/route.ts`
- Add: `__tests__/api/hermes-provider-settings.test.ts`

**Steps:**
1. Read provider/config/model state through server-side controls.
2. Render provider cards with configured/active/available states.
3. Add masked write-only key/config inputs.
4. Require super-admin/operator role for writes.
5. Audit all provider/config mutations.
6. Run API/control-plane tests and typecheck.

---

## Task 11: Composer parity polish

**Objective:** Finish the Hermes Desktop feel in the composer.

**Files:**
- Modify: `components/messages/hermes/MessageComposerBar.tsx`
- Modify: `components/chat/UnifiedChat.tsx`
- Add/modify component tests as needed

**Steps:**
1. Add draft persistence per conversation.
2. Add fast-mode/web-search toggles only when selected runtime advertises support.
3. Add image/file preview improvements while preserving current upload/storage behaviour.
4. Keep context chips, slash commands, and voice button prominent.
5. Run focused component tests and browser smoke.

---

## Task 12: Full verification and rollout

**Objective:** Prove parity work does not regress existing chat/run behaviour.

**Commands:**
```bash
npm test -- --runInBand \
  __tests__/components/chat/UnifiedChat.context.test.tsx \
  __tests__/components/chat/MessageBubble.test.tsx \
  __tests__/components/messages/ModelProviderPicker.test.tsx \
  __tests__/components/messages/RuntimeInspectorRail.test.tsx \
  __tests__/api/conversation-messages-routing.test.ts \
  __tests__/api/conversation-messages-model-overrides.test.ts \
  __tests__/api/conversation-finalize.test.ts \
  __tests__/api/hermes-run-actions.test.ts \
  __tests__/api/hermes-admin-controls.test.ts \
  __tests__/api/messages-model-catalog.test.ts

npm run typecheck
npm run lint:ratchet
git diff --check
```

**Manual browser smoke:**
1. `/portal/messages` signed-in load.
2. Create/select/rename/archive conversation.
3. Send human-only message.
4. Send Pip message with default runtime.
5. Send Pip message with selected model/provider override.
6. Reload during pending run and verify SSE/finalizer resumes.
7. Approve/deny a tool action.
8. Stop an in-flight run as admin/operator.
9. Confirm client role cannot access unsafe provider settings.
10. Confirm no response includes API keys, dashboard tokens, raw profile paths, or local base URLs.

---

## Risks / tradeoffs / open questions

- Prefer per-run overrides over global Hermes config mutation; global switching can affect concurrent sessions.
- Model catalogues must be agent/runtime-target-specific because VPS/local targets can differ.
- Client-facing model choice should likely be preset-based, not raw provider catalogues.
- Provider credentials need audit logs and masked write-only handling.
- `UnifiedChat.tsx` is currently large; decompose first to reduce regression risk.
- Do not copy Hermes terminal/env/filesystem panels into client-facing portal except behind explicit admin/operator controls.

# Hermes Desktop parity for Partners in Biz Messages

Last reviewed: 2026-07-08
Upstream source of truth: <https://hermes-agent.nousresearch.com/docs/user-guide/desktop>

## Verdict

Partners in Biz does **not** yet have every function that Hermes Desktop has.

PiB now has a solid Messages subset: live Hermes run events, pending/finalized assistant messages, model/provider selection, reasoning effort selection, voice-to-composer input, attachments, approvals, stop controls, slash commands, context references, and a runtime inspector rail.

The biggest non-parity item is architectural: Hermes Desktop uses a live `hermes serve` / `tui_gateway` JSON-RPC session model (`session.create`, `prompt.submit`, `session.steer`, `model.options`, `voice.tts`, etc.) and therefore shares Hermes SessionDB state with CLI/TUI/Desktop. PiB Messages uses Firestore conversations and dispatches stateless `/v1/runs` jobs, injecting recent PiB conversation history into the prompt. That is safe for a multi-tenant client portal, but it is **not** the same as Desktop’s shared-session runtime.

## How PiB currently injects chat into Hermes

PiB Messages builds one prompt string in `app/api/v1/conversations/[convId]/messages/route.ts`:

1. Validates conversation access and module reply permission.
2. Parses content, attachments, slash commands, context references, thinking effort, and model/provider overrides.
3. Validates selected model/provider with `validateMessageModelSelection()` before any partial message/run is created.
4. Stores the user message in Firestore.
5. Builds a prompt from:
   - org/client context,
   - conversation participants,
   - multi-agent orchestration context,
   - agent skill policy block,
   - CEO operating rules,
   - attached PiB references,
   - recent conversation history, currently capped to the last 30 user/assistant messages,
   - slash command instruction,
   - latest user content,
   - attachment URLs.
6. Calls `createHermesRun()` in `lib/hermes/server.ts`, which posts to Hermes `/v1/runs` with:
   - `input: hermesInput`,
   - `conversation_id: convId`,
   - optional `model`, `provider`, and `reasoning_effort`,
   - metadata including `conversationId`, `messageId`, `orgId`, `dispatchAgentId`, source `pib-unified-chat`, selected runtime, context refs, and slash command.
7. Stores the returned Hermes `run_id` on the pending assistant message.
8. The browser opens `/api/v1/admin/agents/[agentId]/runs/[runId]/events`, which proxies Hermes SSE from `/v1/runs/{runId}/events` and normalizes events in `lib/hermes/progress-events.ts`.
9. Finalization polls `/api/v1/conversations/[convId]/messages/[msgId]/finalize`, fetches `/v1/runs/{runId}`, and writes the final content/rich parts/UI actions back to the Firestore message.

## Parity matrix

| Hermes Desktop feature | PiB status | Evidence | Gap / next action |
| --- | --- | --- | --- |
| Streaming responses with live tool activity | Partial/covered | `UnifiedChat.tsx` opens `EventSource`; `progress-events.ts` normalizes `message.delta`, tool events, approvals, reasoning summaries | Continue using `/v1/runs` SSE; add a test that normalized `message.delta` reaches visible text if missing from current suite |
| Same conversation history across Desktop/CLI/TUI | Gap by design | PiB stores Firestore conversations and injects recent history into prompt; it does not create Hermes `SessionDB` sessions | Decide whether PiB should adopt Hermes `/api/sessions` for internal/admin chats, or keep Firestore isolation for client-safe chats |
| Drag-and-drop files anywhere in chat | Partial | Composer drop zone in `UnifiedChat.tsx`; attachment API supports limited MIME types | Desktop supports dropping anywhere in the chat area; PiB currently scopes drop handling to the composer form |
| Right-hand preview rail for pages/files/tool outputs | Partial/different | PiB has `RuntimeInspectorRail` and inline attachment previews | Desktop preview rail is broader; PiB needs a preview rail for generated files/pages/tool outputs if we want true parity |
| Composer history with up/down arrows | Gap | No `ArrowUp`/`ArrowDown` prompt-history handling in PiB composer | Add local composer history keyed by conversation/org |
| Queue editing while an agent is running | Gap | PiB can send another message after POST returns, but it does not present/edit a queued prompt list | Add a client-side queue that holds prompts while a run is pending/streaming/waiting, lets Peet edit/reorder/delete, and dispatches after finalization |
| Steering a live conversation | Gap | Desktop has `session.steer`; Hermes `/v1/runs` does not expose an equivalent steer endpoint | Requires either adopting `tui_gateway` sessions for PiB internal chats or adding an upstream `/v1/runs/{id}/steer` API before PiB can implement true steering |
| Stop in-flight run | Covered for admin | `messages/[msgId]/stop/route.ts`, `RuntimeInspectorRail`, and message bubble stop actions call Hermes `/v1/runs/{id}/stop` | Current stop is admin/delete-permission gated; decide whether AI-authorized users should also stop their own runs |
| Approval prompts while a run is paused | Covered | Event normalization emits `approval.required`; `resolveApproval()` posts to `/approval`; rich actions can approve/deny | Keep coverage in message/inspector tests |
| Model/provider picker in composer | Covered | `ModelProviderPicker`, `PinnedModelStrip`, `/conversations/[convId]/models`, `lib/messages/model-catalog.ts` | Add persisted org/user preferences later; current pins are localStorage only |
| Reasoning effort selector | Partial | `agentEffort` UI and `reasoning_effort` field are sent to `/v1/runs` | Confirm upstream Hermes `/v1/runs` honors `reasoning_effort`; Desktop `tui_gateway` definitely honors reasoning on `session.create` |
| Fast mode / service tier | Gap | No PiB composer fast-mode field; Hermes Desktop sends `fast`/service tier via session create | Add fast-mode UI only after confirming the PiB runtime endpoint can honor it |
| Per-model effort/fast presets | Gap | PiB pins models locally, but does not remember effort/fast per model | Add local or Firestore preference store after fast mode exists |
| Per-session YOLO toggle | Gap / probably admin-only | No PiB session-level YOLO toggle | Dangerous-command auto-approval should remain restricted; if implemented, gate to Peet/admin only and show a strong warning |
| Voice input | Covered for browser STT | `VoiceInputButton.tsx` uses browser speech recognition and inserts transcript into composer | Desktop uses Hermes voice mode; PiB should keep browser STT unless backend voice mode is intentionally exposed |
| Read aloud / TTS | Gap | PiB renders audio attachments but no “read aloud” control for assistant messages | Add browser SpeechSynthesis for quick parity, or a Hermes-backed TTS endpoint if server-side voice is required |
| Slash commands | Partial / PiB-specific | PiB has structured slash command metadata and suggestions | Desktop slash command surface is broader and skill-driven; PiB commands are product-specific |
| Context references / `@` mentions | Covered / PiB-specific | PiB supports current page/context refs and `@namespace:` search | Different from Desktop’s cross-profile `@session` links |
| Command palette and global navigation | Gap outside Messages | PiB has normal app nav, not Desktop Cmd+K parity | Track separately if the portal needs Desktop-like keyboard operations |
| Rebindable shortcuts / zoom / language switcher | Gap outside Messages | Not present as Hermes Desktop parity features | Not urgent for Messages runtime parity |
| File browser over working directory | Gap / likely not client-safe | Desktop exposes workspace file browser | Do not expose agent filesystem broadly to clients; consider Peet/admin-only file/artifact browser instead |
| Provider/settings/onboarding panes | Partial admin control plane | PiB has Hermes admin/control surfaces and model catalogue; not full Desktop provider settings/onboarding | Track as Admin Hermes Control Plane parity, separate from Messages |
| Skills/Cron/Profiles/Messaging management panes | Partial/admin-specific | `lib/hermes/server.ts` allowlists admin proxy paths for models/config/tools/skills/sessions/env/profiles/cron | Needs dedicated UX and role gates before claiming Desktop parity |
| Multiple simultaneous profiles/sessions | Partial/different | PiB supports multiple agents/client orgs and Firestore conversations | Desktop concurrent profile sessions are Hermes profile/session constructs, not PiB client/org spaces |

## Required direction

1. Keep PiB client portal chat on Firestore + `/v1/runs` unless Peet explicitly wants Hermes SessionDB semantics exposed.
2. For Peet/admin internal chats, consider a second “Desktop-mode runtime” path that uses Hermes `hermes serve` session APIs for true parity: `session.create`, `prompt.submit`, `session.steer`, `model.options`, `model.select`, `voice.tts`, queue handling, and shared SessionDB.
3. Do not fake steering. A queued next-turn message is not the same as Desktop `session.steer`, because Desktop injects text into the running agent after the next tool result.
4. Do not expose YOLO, filesystem browsing, provider credentials, or profile settings to normal client users.

## Automated drift guard

This repo now includes `scripts/check-hermes-desktop-parity.mjs` and `config/hermes-desktop-parity-baseline.json`.

Run locally:

```bash
npm run check:hermes-desktop-parity
```

When the upstream Desktop docs legitimately change and PiB has been reviewed/updated:

```bash
npm run check:hermes-desktop-parity -- --update-baseline
```

The scheduled GitHub Action `.github/workflows/hermes-desktop-parity.yml` runs weekly and on relevant PRs. It fails when:

- the upstream Desktop docs section changes from the committed baseline,
- required upstream feature phrases disappear,
- a PiB code marker for an existing parity feature disappears.

This does not automatically implement new Hermes features, but it gives us a durable tripwire so Desktop upgrades force a PiB review instead of silently drifting.

## Recommended implementation backlog

1. Add read-aloud for assistant messages using browser `speechSynthesis` first; evaluate Hermes-backed TTS later.
2. Add local composer history: empty composer + ArrowUp/ArrowDown should recall prior prompts per conversation.
3. Add an explicit queued-message panel for pending/streaming runs: queue, edit, delete, send after current run finalizes.
4. Investigate true steering support:
   - preferred: upstream Hermes exposes `/v1/runs/{runId}/steer`, or
   - alternate: PiB admin chats use `hermes serve` JSON-RPC sessions rather than `/v1/runs`.
5. Add fast-mode/service-tier only after confirming the chosen runtime endpoint honors it.
6. Decide whether admin-only YOLO/session controls belong in PiB at all.

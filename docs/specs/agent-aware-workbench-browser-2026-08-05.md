# Agent-Aware Workbench Browser ("CoBrowse") — Milestone 1 + 2 Build Spec (2026-08-05)

Status: APPROVED (Peet, chat Tav3VOFJAnMWY7xrMg6Y — "implement both, sequenced", YOLO on execution)
Owner: Sage (research + spec), Theo (runtime plumbing), Quinn (review)
Research: wiki hermes-desktop-in-app-browser-2026-08-05.md (source: Hermes commit 39a74aaae)

## Goal

Give Partners in Biz agents Hermes-Desktop-class browser capability inside Messages:

- Slice 1 — "agent opens a page beside the chat": the agent can open a page, it appears
  in the workbench browser tab, and the agent drives it with *text awareness*
  (accessibility-tree snapshots, not just screenshots), handling dialogs, iframes and
  console errors like Hermes' CDP supervisor.
- Slice 2 — "ask it anything about what we're both looking at": the same session can be
  driven by user OR agent; what you see is what the agent acts on, with driver arbitration.

## What already exists (verified in repo)

- Device-side headless Chrome over raw CDP (loopback): runtime-installers/runtime/workbench-browser.ts
  — CdpConnection, navigate/capture/click/type/press/scroll/follow/kill, JPEG frames,
  sanitized env, 30-min TTL, heartbeat, profile cleanup. Chrome is launched with
  `--headless=new --remote-debugging-port=0 --remote-debugging-address=127.0.0.1`.
- Control plane: Firestore session docs + encrypted control queue + signed claim/lease
  (lib/messages/workbench/browser-session-store.ts, browser-sessions.ts), routes under
  app/api/v1/conversations/[convId]/workbench/browser/sessions/**.
- Client: AgentWorkbenchRail -> WorkbenchBrowserPanel (frames, click-at/type-at, design mode,
  tunnel preview, follow).
- Security: loopback CDP, http(s)-only URL sanitizer (no embedded creds), approval gate
  (sessions start awaiting_approval), sanitized shell env.

## Gaps to close (Hermes parity)

1. Accessibility-tree snapshot with stable refs (@e1..) — agent reads the page as text.
2. CDP supervisor state: pending dialogs, frame tree incl. OOPIFs, console ring (50).
3. Dialog response control (accept/dismiss/promptText).
4. Click-by-ref (ref -> backendDOMNodeId -> box model -> center coords).
5. Console read tool.
6. Agent toolset (new skill) + display bridge (auto-open agent-initiated session).
7. Redaction of browser-originated text (snapshot/console) before it reaches the agent.
8. Private-network guard for agent-initiated navigation (user-initiated keeps localhost
   access — the linked computer's own dev server is the point).
9. Slice 2: driver arbitration (user/agent) + attach tool.

## Design

### A. Device worker (runtime-installers/runtime/workbench-browser.ts)

New per-entry supervisor state (built from CDP events on top of the existing CdpConnection):

- pendingDialog: { type, message } | null  — Page.javascriptDialogOpening / javascriptDialogClosed
- consoleRing: Array<{ level, text, url, line }> capped 50 — Runtime.consoleAPICalled,
  Runtime.exceptionThrown (top page + OOPIF child sessions)
- frameTree: Array<{ frameId, parentId, url, name, oopif }> — Page.frameAttached /
  frameNavigated / frameDetached, Target.attachedToTarget / detachedFromTarget (flatten:
  autoAttach) for cross-origin iframe children. Child sessions get Runtime/Page enabled so
  their console/dialog events are captured and their AX trees are addressable.

New controls (add to WorkbenchBrowserControl union, validated by assertValidControl):

- { kind: 'snapshot' } — builds the AX text snapshot + supervisor state, posts a progress
  chunk { stream: 'snapshot', snapshot: {...} } and returns it.
- { kind: 'console' } — posts { stream: 'console', entries: [...] }.
- { kind: 'dialog', accept: boolean, promptText?: string } — Page.handleJavaScriptDialog.
- { kind: 'click_ref', ref: string } — resolve ref -> backendDOMNodeId -> 
  DOM.scrollIntoViewIfNeeded + DOM.getBoxModel -> center -> Input.dispatchMouseEvent.

Snapshot shape:
```
{
  url, title,
  ax: "  [@e1] button \"Search\"\n  [@e2] textbox \"Query\" value=\"...\"\n...",
  refs: { "@e1": { backendDOMNodeId, role, name } },   // backendDOMNodeId for click_ref
  pendingDialog: { type, message } | null,
  frames: [...],          // frame tree incl. OOPIFs
  console: [...],         // tail of ring
}
```

AX building: Accessibility.getFullAXTree on the page session; walk nodes with a role/name
(banner/main/button/link/textbox etc. and anything with a non-empty name or value), emit
text lines with refs, cap ~15k chars with a `… truncated` marker, keep ref map. Redact
sensitive substrings (emails, api keys, tokens, password values) before returning.

### B. Control plane (lib/messages/workbench/browser-sessions.ts + browser-session-store.ts)

- Extend WorkbenchBrowserSessionControl union + sanitizers for the 4 new kinds.
- Progress chunk stream set gains 'snapshot' | 'console' (validated, capped payload).
- Session doc gains:
  - initiator: 'user' | 'agent' (create-time; default 'user')
  - driver: 'user' | 'agent' | 'idle' (last actor; default 'idle')
  - allowPrivateNetwork: boolean (default false for agent-initiated; true for user-initiated
    sessions so the dev-server preview keeps working)
- Private guard: when enqueuing navigate/click_ref for an agent-initiated session, reject
  private/internal hosts (reuse the privateHostname logic from WorkbenchBrowserPanel) unless
  allowPrivateNetwork.
- Driver arbitration: enqueueControl stamps driver by actorUserId === session.ownerUserId
  (user) vs agent. A control from the non-current driver is rejected 409 with a clear
  message (client shows "Agent is driving" and the Take Control affordance; agent skill
  shows "User is driving — wait or request takeover").

### C. API routes (new)

- GET  .../sessions/{id}/snapshot   -> latest snapshot chunk (or 202 while pending)
- GET  .../sessions/{id}/console    -> latest console chunk
- POST .../sessions/{id}/dialog     { accept, promptText? }
- POST .../sessions/{id}/click-ref  { ref }
- POST .../sessions/{id}/driver     { driver: 'user' | 'agent' }  (takeover)
- POST .../sessions (create)        accepts { startUrl?, initiator? } — agent-initiated still
  starts awaiting_approval (approval gate unchanged; the browser reaching the internet from
  the user's computer is sensitive).

### D. Client (WorkbenchBrowserPanel + AgentWorkbenchRail + UnifiedChat host)

- Public session gains initiator + driver + latest snapshot text (capped).
- Auto-open: when a session with initiator 'agent' appears and has not been acknowledged,
  the rail auto-switches to the browser tab once and shows an "Agent preview" badge
  (offer-don't-hijack: one-time, user can close).
- Driver badge: when driver === 'agent', disable the user's drive controls (click/type/press)
  and show "Agent is driving — Take control". Take Control calls the driver route.
- Snapshot viewer: a small "Agent view" toggle that renders the AX text snapshot so the user
  can see exactly what the agent sees (the shared-reality proof).

### E. Agent skill (packs/pib-system-skills/skills/browser-agent/SKILL.md)

Tools (each: conversationId from run context, orgId + delegation token from env):
- browser_open { url?, conversationId } -> create session (awaiting_approval; tell the user
  to Approve in the browser tab)
- browser_snapshot { sessionId } -> AX text + dialogs + frames + console tail
- browser_navigate { sessionId, url }
- browser_click_ref { sessionId, ref } / browser_click { sessionId, x, y }
- browser_type { sessionId, text } / browser_press { sessionId, key } / browser_scroll {...}
- browser_console { sessionId } / browser_dialog { sessionId, accept, promptText? }
- browser_attach { conversationId, sessionId? } -> attach to a running user session (slice 2)
- browser_take_control { sessionId, driver }

### F. Deployment

- Runtime: rebuild pib-runtime bundle (build-runtime.sh) + install on linked computers
  (routes). This is the existing workbench-browser.ts -> the change ships with the next
  runtime release; the control-plane changes are server-side (immediate).
- Skills: add browser-agent to packs/pib-system-skills + .claude/skills mirror; deploy via
  install-vps-skills.sh + publish-pib-system-skills-repo.sh (pack repo bump).

## Security model (ported from Hermes)

- Loopback-only CDP (already true).
- http(s)-only URLs, no embedded credentials (already true).
- Approval gate on session start (already true).
- Private-network guard for agent navigation (new, slice 1).
- Secret scrubbing: browser env = sanitizedShellEnv (already true); snapshot/console text
  redaction (new).
- Driver arbitration prevents user/agent click races (slice 2).

## Tests

- Device worker: unit tests for assertValidControl new kinds, snapshot builder + ref map,
  redaction, click_ref coordinate resolution (dependency seams exist: __setWorkbenchBrowserDependenciesForTests).
- Server: sanitizer tests, private-guard tests, driver arbitration tests, route handler
  tests (dependency-injected handlers mirror the existing route test pattern).
- Client: component tests for auto-open + driver badge (existing test infra).

## Success criteria (slice 1)

1. Agent creates a session -> tab opens beside the chat -> user approves.
2. Agent reads a text snapshot of Reddit/HN, clicks by ref, types, handles a JS dialog,
   reads console errors — without a vision model.
3. Snapshot never contains a scrubbed secret.
4. Agent cannot navigate an agent-initiated session to private/internal addresses.
5. Tests green; typecheck clean; commit on origin/development.

## Success criteria (slice 2)

6. User-started session: agent attaches, sees the same page state, user sees "Agent is
   driving" while the agent acts; Take Control returns control; no click races.

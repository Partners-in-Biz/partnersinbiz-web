# Cursor Agent Tool Credential (BYOK for `cursor-agent`) — Change Spec (2026-08-28)

Status: DRAFT — awaiting Peet approval before implementation
Owner: Pip (routing/spec), Theo (implementation), Quinn (review)
Related: `docs/specs/` convention; delivery gate per Partners delivery standard
Not in scope: chat-inference providers. Cursor stays out of the LLM model picker.

## Goal

Let **organisations and users in Partners in Biz set their own Cursor API keys** so any
Hermes agent (on the org VPS or a member's linked computer) can kick off `cursor-agent`
runs. This makes the VPS lane self-serve: an org admin sets one key shared by the org's
VPS agents, and individual members can set their **own** user-scoped key so their runs
burn *their* Cursor quota instead of the org's.

## What already exists (verified in repo)

- Full BYOK credential lifecycle in `lib/llm-providers/`: `connectLlmApiKey` with
  `scope: 'org' | 'user'` (`client.ts:46-60`); connection store `llm_provider_connections`
  with `scopeKeyRef`, `credentialsEnc` (AES-256-GCM), `credentialVersion`, `syncedAgentIds`
  (`types.ts:17-43`).
- Sync semantics exactly right: org connections → org VPS only; personal connections →
  owner's linked computers (`sync-hermes.ts:3-4`); env delivery `{ mode: 'env', envVar,
  value }` (`sync-hermes.ts:55-68`); pull jobs via `linked-delivery.ts` with device-owner
  authorization checks (`linked-delivery.ts:31-37`).
- API surface already Cursor-aware: `GET/POST /api/v1/llm-providers/connections` returns
  `notes.cursor` in its catalog response (`client.ts:33-38`); today it holds
  `UNSUPPORTED_CURSOR_NOTE` (`connections/route.ts:57`) — the "Cursor has no third-party
  inference API" note from `providers.ts:49-51`.
- Fleet install proof: official installer `curl https://cursor.com/install | bash` works
  on the VPS (`cursor-agent` v2026.08.25 live, 2026-08-28); Mac lane already
  authenticated via Cursor-app OAuth and smoke-tested headless.

## Design

### A. New sibling registry: "agent tool credentials"

Do **not** add Cursor to `LLM_PROVIDERS` (it would pollute the chat model picker; the
`UNSUPPORTED_CURSOR_NOTE` documents why). Instead add a narrow registry alongside it:

```ts
// lib/llm-providers/tool-credentials.ts (new)
export type AgentToolCredentialKey = 'cursor'
export interface AgentToolCredentialDefinition {
  key: AgentToolCredentialKey
  label: string
  description: string
  envVar: string            // 'CURSOR_API_KEY'
  credentialFields: LlmCredentialField[]  // [{ key: 'apiKey', label: 'Cursor API key', secret: true, placeholder: 'crsr_…' }]
  consoleUrl: string        // Cursor dashboard API keys page
  runsCommand: string       // 'cursor-agent' (for display/help)
}
export const AGENT_TOOL_CREDENTIALS: AgentToolCredentialDefinition[] = [ cursorDef ]
```

Reuse the existing store, scope, and sync machinery by generalizing the few
Cursor-specific seams:
- `LlmProviderKey`/`LlmProviderConnection.provider` — widen to accept
  `'cursor'` (or introduce a parallel discriminated union; pick whichever touches fewer
  call sites — implementation decision for Theo).
- `resolveLlmDeliveryForConnection` (`sync-hermes.ts:55-68`) — add a `cursor` branch:
  `{ mode: 'env', envVar: 'CURSOR_API_KEY', value: credentials.apiKey }`.
- `getLlmProvider(conn.provider)` fallback path must handle the tool-credential keys.

### B. Update the catalog note

Replace `notes.cursor` (`connections/route.ts:57`) from the unsupported-inference note to
a **supported-agent-tool** note, e.g.:
"Cursor API keys power the `cursor-agent` CLI for autonomous coding-agent runs from
Hermes. Org keys sync to the org VPS; personal keys sync to your linked computers. Runs
consume the key owner's Cursor credits."

### C. UI (Settings → LLM providers / Agent tools)

Add a "Coding agent tools" section (or tab) beside the model-provider list, reusing the
same connection card + connect/revoke flow:
- Scope radio (org / personal) — same semantics as existing providers.
- Key field with placeholder `crsr_…`, console link.
- Org keys show a "shared with N agents on the org VPS" caption.
- Personal keys show "synced to your linked computers only".
- Revoke removes the binding and deletes the env from runtimes (existing revoke path).

### D. Runtime delivery

No new machinery needed: the existing sync job writes `CURSOR_API_KEY` into the target
profile's env (same as `DEEPSEEK_API_KEY` today). VPS profiles pick it up on next agent
start; Mac linked computers via the pull job.

## Acceptance criteria

1. Org-scoped Cursor key set by an org admin syncs to the org VPS Hermes profiles and
   `cursor-agent` runs authenticated there (smoke: `cd /tmp && cursor-agent --mode ask
   --print -f "…CURSOR_LANE_OK"` → `CURSOR_LANE_OK`, exit 0).
2. A member's user-scoped key syncs only to their linked computer, never the org VPS.
3. Revoking a connection removes the env from all synced targets.
4. Cursor does **not** appear in the chat model picker (no `LLM_PROVIDERS` entry).
5. Tests: unit for `resolveLlmDeliveryForConnection` cursor branch + route catalog test
   asserting `notes.cursor` text.

## Gates

- Client-visible UI change → deploy/preview promotion stays human-gated.
- Keys are encrypted at rest (reuse `credentialsEnc`); never logged.
- Approval task in Projects/Kanban required before implementation starts.

## Open questions for Peet

1. OK to widen `LlmProviderKey` to include `cursor`, or prefer a separate
   `toolCredentialConnections` collection to keep the two registries fully separate?
   (Recommendation: separate collection — cleaner lifecycle, no risk to the model picker.)
2. Where should the UI live: inside the existing LLM providers settings page as a second
   section, or a new Settings tab? (Recommendation: second section, faster to ship.)

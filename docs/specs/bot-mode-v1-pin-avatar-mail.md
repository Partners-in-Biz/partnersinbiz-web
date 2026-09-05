# PiB Bot mode v1 — pin, moving avatar, per-bot email

Status: shipped to `development` (2026-09-05). Scope is Messages / Bot mode only; not a Hermes Desktop rewrite.

## 1. Pinned favourite bot

- One pinned bot id per user + org, stored on the existing sidebar preference doc
  `users/{uid}/messagesSidebarPreferences/{orgId}` as `pinnedBotId` (string | null).
- API: `GET/POST /api/v1/account/messages-sidebar-preferences?orgId=` now returns and accepts `pinnedBotId`
  alongside `hiddenFolderKeys`. Either field may be sent alone.
- UI: `PinnedBotChip` sits above the bot rail switcher (mobile list sheet and desktop rail) and at the top of
  `BotModeLanding`. Tap → `selectBot(botId)` (latest channel, else a new channel with that bot).
  Pin / unpin from the roster row or the bot profile card.

## 2. Bot look (animated avatar)

- `BotAvatar` renders `blob` (default), `geometric`, or `image` (uploaded still). Motion runs while idle and gets
  faster while presence is `thinking` / `working` or the active conversation is streaming. `prefers-reduced-motion`
  → `data-motion="static"` and all keyframes are disabled (`components/messages/bot-mode/bot-avatar.css`).
- Storage: `bot_appearance/{orgId}_{agentId}` → `{ orgId, agentId, avatarUrl, avatarStyle, updatedByUserId }`.
  Per org so a tenant's look for a shared specialist (pip, theo, …) never leaks to another tenant.
  `GET /api/v1/orgs/{orgId}/visible-agents` merges `avatarUrl` / `avatarStyle` onto each agent.
- API:
  - `GET  /api/v1/orgs/{orgId}/bots/{agentId}/appearance` → look + mailbox + `canEditLook` / `canProvisionMailbox`
  - `PATCH /api/v1/orgs/{orgId}/bots/{agentId}/appearance` `{ avatarStyle }` (`image` requires an upload first)
  - `POST /api/v1/orgs/{orgId}/bots/{agentId}/avatar` multipart `file` — png / jpg / webp / gif, ≤ 2 MB,
    stored under `bot-avatars/{orgId}/{agentId}/` in Firebase Storage (Admin SDK; client Storage stays denied).
- No generated faces, no video pipeline. GIF loops ride on `<img>`.

## 3. Per-bot email → Hermes Mail Agent

PiB never invents an address. The Bot's Hermes runtime owns the inbox; PiB stores what the runtime returns on the
`agent_team/{agentId}` doc as `mailbox`:

```ts
{ provider: 'hermes-mail-agent', address, inboxId, status: 'active' | 'pending' | 'error', error, updatedAt }
```

### Hermes Mail Agent endpoint contract (called through `callAgentPath`, agent runtime base URL + agent API key)

| Method | Path              | Body                        | 2xx response                        |
|--------|-------------------|-----------------------------|-------------------------------------|
| POST   | `/api/mail/inbox` | `{ agentId, displayName }`  | `{ address, inboxId }` (`email` / `inbox_id` accepted) |

- `404` / `501` or an unreachable runtime → PiB answers `503` with the `[NEED]` note below and stores nothing.
- Any other non-2xx → `502` with the runtime's `error` string.
- A 2xx without a syntactically valid address → `502`, nothing stored.

### PiB API

- `GET  /api/v1/orgs/{orgId}/bots/{agentId}/mailbox` → `{ mailbox, canProvisionMailbox }` (any org member who can see the bot)
- `POST /api/v1/orgs/{orgId}/bots/{agentId}/mailbox` → provisions via the contract above. Allowed for platform admins,
  or org owners/admins for custom org bots (`canManageLinkedAgent`). Idempotent once `status === 'active'`.

### [NEED] — VPS / linked-computer install

The Hermes Mail Agent (AgentMail-backed) is not installed on the PiB VPS or linked computers yet and this repo has no
prior per-bot mail path (the workspace mailbox under `/api/v1/agent/email/*` is per human user, keyed
`${orgId}_${uid}`, and stays untouched — Stean mailbox and `pib_dlg_` delegation paths are unaffected).

To turn the stub live, on each runtime that hosts bots:

1. Install the Hermes Mail Agent with AgentMail credentials (`AGENTMAIL_API_KEY`, sending domain).
2. Expose `POST /api/mail/inbox` per profile, authenticated with the profile's agent API key.
3. Provision from the Bot profile card in Messages → Bot mode; the address appears on the card once returned.

Until then the profile card shows "No mailbox yet" and the provision button surfaces the `[NEED]` note inline.

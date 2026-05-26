---
name: client-manager
description: >
  Manage client organisations and onboarding on the Partners in Biz platform. Create orgs, invite and
  manage team members, sync platform CRM Company/Contact links, generate client logins, update brand profiles, route portal
  enquiries and messages, and run product onboarding flows. Use this skill whenever the user mentions
  anything related to clients or organisations, including but not limited to: "create a client",
  "new client", "set up a new org", "create organisation", "onboard a client", "client onboarding",
  "athletic club onboarding", "athleet onboarding", "invite team member", "add a user to an org",
  "invite user", "remove member", "change member role", "client members", "client team", "client roles",
  "list organisations", "list clients", "client settings", "client billing details",
  "link client to org", "link a client account", "create login for client", "create client login",
  "client portal message", "respond to enquiry", "log enquiry", "enquiry inbox",
  "update brand profile", "set brand colors", "set brand voice", "brand guidelines",
  "fetch brand profile", "send brand kit", "platform owner", "organisation slug",
  "leave a note on this client", "comment on client", "@mention client owner",
  "notify when new client is created", "client created webhook". If in doubt, trigger — this skill owns
  the full client/organisation lifecycle.
---

# Client Manager — Partners in Biz Platform API

This skill handles the full client lifecycle on Partners in Biz: creating client organisations, managing members and roles, linking each client tenant to its platform-owner CRM Company and real client members to CRM Contacts, issuing portal logins, running product-specific onboarding flows, routing portal enquiries, and maintaining brand profiles that downstream skills (content, social, email) read from.

## Base URL & Authentication

```
https://partnersinbiz.online/api/v1
```

All authenticated endpoints require:

```
Authorization: Bearer <AI_API_KEY>
```

AI agents and admins have full access. Override base URL via `PIB_API_BASE` for local dev.

## orgId conventions

- `organisations` are **top-level tenants**. There is a `platform_owner` org (type = `platform_owner`) and many `client` orgs (type = `client`).
- Most endpoints scope by `orgId` in the path or body. When a route takes `orgId` in the path (`/organizations/[id]`), that IS the org.
- Cross-resource endpoints (`/comments`, `/notifications`) take `orgId` as query or body.

## Admin-as-client portal access

Platform admin access and client portal membership are deliberately separate:

- `allowedOrgIds` scopes what a normal PiB admin can see/manage in admin surfaces. It does not grant access to a client's private portal CRM.
- Client portal access is explicit membership via `orgMembers/{orgId}_{uid}` and `users.orgIds`.
- To let a PiB staff/admin user enter a client portal, add that existing staff account on `/admin/org/[slug]/team` or `POST /organizations/[id]/members`.
- Adding an existing PiB staff/admin member mirrors the client org into `users.orgIds` without changing the staff user's primary `orgId=pib-platform-owner`.
- `pib-platform-owner` / `partners-in-biz` is PiB's own Platform workspace, so PiB owners/admins can open portal/CRM there. Other client orgs still require explicit membership.
- The Admin/Portal mode switch only appears when `/api/v1/portal/orgs` includes the selected org.

When debugging "You do not have access to this organisation", first check explicit membership, not `allowedOrgIds`.

## Platform CRM sync for clients

Client organizations and members are mirrored into the Partners in Biz platform-owner CRM:

- One CRM Company per client org in `pib-platform-owner`, deduped by `linkedOrgId` first, then normalized name/domain.
- One CRM Contact per active real client member, deduped by `linkedUserId` first, then email, linked to that Company by `companyId` and `linkedOrgId`.
- Client setup is not complete until the tenant org, its platform CRM Company, and its real member Contacts are in sync. Do not rely on the legacy `/clients` collection as the client/account source of truth.
- Internal `@partnersinbiz.online` staff can be explicit portal members for support/admin access, but they are skipped as client Contacts during backfills and should not be counted as client stakeholders.
- Member removal marks the platform Contact inactive/former instead of deleting relationship history.
- PiB-issued invoices, quotes, projects, and reports should reuse the platform CRM Company (`companyId` / `sourceCompanyId`) whose `linkedOrgId=<clientOrgId>` and the platform CRM Contact (`contactId` / `sourceContactId`) whose `linkedUserId=<client user id>` when a specific stakeholder is involved.

App code should use `lib/platform-owner/relationships.ts`; existing-data repair uses `scripts/backfill-platform-owner-crm-relationships.ts` in dry-run mode before `--commit`, then `scripts/backfill-platform-owner-resource-company-links.ts` to attach existing PiB-issued resources to the Company links.

## Collaboration primitives

Every resource this skill creates/modifies records `createdBy` + `createdByType: 'user' | 'agent' | 'system'`. Agents leave trails exactly like humans do.

- **Idempotency**: any `POST` that creates a resource accepts an `Idempotency-Key` header. Same key replays the cached response for 24h.
- **Unified comments**: see `POST /comments` with `resourceType: 'client_org'` — leave notes on a client org.
- **Unified inbox**: `GET /inbox` aggregates assignments, mentions, enquiries, overdue items across the workspace.
- **Notifications**: created automatically for team invites, enquiry replies, brand updates.

## Response envelope

```json
{ "success": true, "data": { ... }, "meta": { "total": 50, "page": 1, "limit": 20 } }
{ "success": false, "error": "Human-readable message" }
```

---

## API Reference

### Organisations

#### `GET /organizations` — auth: client
List orgs the current user has access to. AI/admin sees all active orgs; clients see only orgs they are a member of.

Response: array of `OrganizationSummary`:
```json
{ "id": "org_abc", "name": "Acme", "slug": "acme", "type": "client", "status": "active",
  "description": "...", "logoUrl": "...", "website": "...", "memberCount": 3, "createdAt": "...", "updatedAt": "..." }
```

#### `POST /organizations` — auth: admin
Create a new organisation.

Body:
```json
{
  "name": "Acme Corp",
  "type": "client",
  "status": "active",
  "description": "...",
  "logoUrl": "...",
  "website": "...",
  "industry": "...",
  "billingEmail": "billing@acme.com",
  "plan": "pro"
}
```

Required: `name`. Slug is auto-generated via `slugify(name)` — 409 if slug already taken.

Response (201): `{ "id": "org_xyz", "slug": "acme-corp" }`

The creating user is added as `{ userId, role: 'owner' }` in `members`.

Client-org creation should also ensure the platform-owner CRM Company exists for the org (`companies.orgId=pib-platform-owner`, `companies.linkedOrgId=<ORG_ID>`). If the route does not return the Company id, verify through CRM or run the platform-owner relationship backfill before creating PiB-issued invoices, quotes, or projects for the client.

#### `GET /organizations/[id]` — auth: admin
Full org document including `members[]`, `settings`, `brandProfile`, `billingDetails`.

#### `PUT /organizations/[id]` — auth: admin
Update org fields. Any of: `name`, `description`, `logoUrl`, `website`, `industry`, `billingEmail`, `status`, `plan`, `brandProfile`, `settings`, `billingDetails`.

`settings` and `billingDetails` merge (deep for `billingDetails.address` + `billingDetails.bankingDetails`). `brandProfile` replaces the whole object — use the dedicated `PUT /agent/brand/[orgId]` for partial brand writes.

#### `DELETE /organizations/[id]` — auth: admin
Soft-delete (`active: false`). Record stays for audit.

### Members

#### `GET /organizations/[id]/members` — auth: admin
List members with user details (displayName, email, photoURL joined from `users` collection).

#### `POST /organizations/[id]/members` — auth: admin
Add a member by email. Body: `{ email: string, role?: 'owner'|'admin'|'member' }`. Defaults role to `member`.

If the user exists in Firebase Auth, they're added directly. If not, the route creates an invite record — check response for `{ inviteSent: true, userId? }`.

If the user is an existing PiB staff/admin account, this also grants explicit client-portal access for that organization by updating `orgMembers` and mirroring the org into `users.orgIds`; it does not change the user's primary platform-owner account.

Adding a real client member should sync a platform-owner CRM Contact linked to the client's Company (`contacts.linkedUserId=<uid>`, `contacts.linkedOrgId=<orgId>`, `contacts.companyId=<companyId>`). If the member is PiB internal staff, grant portal access but do not treat them as the client Contact for billing/project handoff.

#### `GET /organizations/[id]/members/[userId]` — auth: admin
Get a single member with user details.

#### `PUT /organizations/[id]/members/[userId]` — auth: admin
Update member role. Body: `{ role: 'owner'|'admin'|'member' }`. Cannot demote the last owner.

#### `DELETE /organizations/[id]/members/[userId]` — auth: admin
Remove a member. Cannot remove the last owner.

### Org accounts (billing/stripe linkage placeholder)

#### `GET /organizations/[id]/accounts` — auth: admin
Returns billing/subscription account details for the org (platform-owner-only records). Read this to determine plan + status before generating invoices or linking clients.

### Link client

#### `POST /organizations/[id]/link-client` — auth: admin
Legacy association route. Body: `{ clientId: string }`. Sets `linkedClientId` on the org for backwards compatibility with old client/contact records.

For current setup, the durable relationship is the platform-owner CRM Company/Contact link: `companies.linkedOrgId=<orgId>` and member `contacts.linkedUserId=<uid>` / `contacts.linkedOrgId=<orgId>`. Use `link-client` only when you must preserve an older `/clients` record reference.

Response: `{ orgId, clientId, linked: true }`.

### Create login

#### `POST /organizations/[id]/create-login` — auth: admin
Provision a portal login for a client user. Body:
```json
{ "email": "contact@acme.com", "displayName": "Jane Doe", "role": "member" }
```

Creates a Firebase Auth user (or links an existing one) and adds them to `members`. Sends a welcome email with a sign-in link. Returns `{ userId, inviteSent: true }`.

New client logins and member updates should also keep the PiB platform-owner CRM Company/Contact relationship current through the platform CRM sync helper. After creating the primary login, verify the client has exactly one current platform CRM Company and that the primary stakeholder Contact is linked to it.

### Clients (legacy/simple list — not the client setup source of truth)

A lightweight legacy "contact-of-contacts" collection used by older admin UI paths. Do not use it as the canonical client/account record for new setup. Current setup uses `organizations` for tenants plus platform-owner CRM `companies`/`contacts` for the business and people links. For full CRM power, use the `crm-sales` skill's `/crm/contacts` and `/crm/companies`.

#### `GET /clients` — auth: admin
List all clients ordered by `createdAt desc`.

#### `POST /clients` — auth: admin
Create a client record. Required: `name`, `email` (valid). Optional: `company`, `phone`, `status`, `tags`, `source`, `notes`.

### Onboarding (product-specific)

#### `POST /onboarding` — **public, no auth**
Public submission endpoint for product onboarding. Currently scoped to the Athleet product. Any public form-style submission should use this for pre-product intake.

Body (Athleet):
```json
{
  "product": "athleet-management",
  "clubName": "Blue Bulls Rugby",
  "contactName": "Coach Smith",
  "contactEmail": "coach@bluebulls.com",
  "contactPhone": "+27...",
  "memberCount": 80,
  "notes": "..."
}
```

Required: `product` (must be in `['athleet-management']`), `clubName`, `contactEmail` (valid). Creates a record in `onboarding_submissions` and emails the platform owner.

### Portal enquiries

Inbound enquiries from the public portal.

#### `GET /portal/enquiries` — auth: admin
List enquiries. Filter by `status` (`new`, `read`, `replied`, `archived`).

#### `POST /portal/enquiries` — **public**
Submit a new enquiry. Body: `{ name, email, message, source? }`.

#### `GET /portal/enquiries/[id]` — auth: admin
#### `PATCH /portal/enquiries/[id]` — auth: admin
Update `status` or add `replyNote`.

### Portal messages

#### `GET /portal/messages` — auth: admin
Inbox of messages between platform and client users across all orgs.

#### `POST /portal/messages` — auth: admin or client
Send a message. Body: `{ orgId, subject, body, threadId? }`.

### Brand profile

Agents depend on this endpoint for every piece of content, design, or copy they generate. **Always call `GET /agent/brand/[orgId]` before producing any output for a client.** The profile is the single source of truth.

#### `GET /agent/brand/[orgId]` — auth: admin
Returns the full brand profile. Key fields:

```json
{
  "orgId": "...", "name": "Acme", "industry": "...",
  "brandProfile": {
    "logoUrl": "...", "logoMarkUrl": "...", "faviconUrl": "...", "bannerUrl": "...",
    "tagline": "Software your competitors will copy.",
    "oneLiner": "We build X for Y so they can Z.",
    "keyDifferentiators": ["EFT-first invoicing", "no Stripe", "same person from quote to launch"],
    "toneOfVoice": "Direct, confident, honest. No jargon.",
    "targetAudience": "Ambitious SMEs across SA, UK, US",
    "personas": [
      { "name": "The Founder", "role": "CEO / owner-operator", "painPoints": "..." }
    ],
    "doWords": ["ship", "build", "craft", "real", "honest"],
    "dontWords": ["leverage", "synergy", "innovative", "world-class"],
    "designAesthetic": ["minimal", "bold", "dark"],
    "colorMode": "dark",
    "competitors": [
      { "url": "https://competitor.com", "relationship": "differentiate" },
      { "url": "https://inspiration.com", "relationship": "inspire" }
    ],
    "imageryTypes": ["photography", "illustration"],
    "imageryMoods": ["clean", "warm"],
    "fonts": {
      "heading": "Instrument Serif", "body": "Geist Sans",
      "mono": "Geist Mono", "weights": "400, 600, 700",
      "headingScale": "large"
    },
    "socialHandles": { "twitter": "@handle", "linkedin": "company/slug" },
    "guidelines": "Free-form markdown guidelines..."
  },
  "brandColors": {
    "primary": "#F5A623", "secondary": "#7C5CFF", "accent": "#F5A623",
    "background": "#0A0A0B", "surface": "#141416",
    "text": "#EDEDED", "textMuted": "#8B8B92", "border": "rgba(255,255,255,0.08)",
    "success": "#4ADE80", "warning": "#F59E0B", "error": "#EF4444",
    "notes": {
      "primary": "Use only for CTAs and key highlights",
      "secondary": "Gradient meshes and atmospheric accents only"
    }
  }
}
```

#### `PUT /agent/brand/[orgId]` — auth: admin
Partial update — merges into `brandProfile` (top-level) and `settings.brandColors`. Pass only the fields you want to update.

Body (any subset of the schema above):
```json
{
  "brandProfile": {
    "tagline": "Software your competitors will copy.",
    "toneOfVoice": "Direct, confident, honest.",
    "doWords": ["ship", "build"],
    "designAesthetic": ["minimal", "bold"],
    "personas": [{ "name": "The Founder", "role": "CEO", "painPoints": "..." }],
    "competitors": [{ "url": "https://x.com", "relationship": "differentiate" }]
  },
  "brandColors": {
    "primary": "#F5A623",
    "background": "#0A0A0B",
    "notes": { "primary": "CTAs only" }
  }
}
```

Response: `{ orgId, updated: true }`.

#### Brand profile field reference

| Field | Type | Purpose |
|-------|------|---------|
| `tagline` | string | Short punchy line — hero headline |
| `oneLiner` | string | 1-sentence what-we-do for intros and meta descriptions |
| `keyDifferentiators` | string[] | Bullet points that set the brand apart |
| `toneOfVoice` | string | How to write — style, register, things to avoid |
| `targetAudience` | string | Who the brand serves |
| `personas` | `{name, role, painPoints}[]` | Named personas for targeted content |
| `doWords` | string[] | Words to actively use |
| `dontWords` | string[] | Words to never use |
| `designAesthetic` | string[] | Tags: minimal, bold, editorial, playful, corporate, luxury, tech, warm, dark, light |
| `colorMode` | `light\|dark\|both` | Primary rendering mode for UI/web |
| `competitors` | `{url, relationship: differentiate\|inspire}[]` | Reference brands |
| `imageryTypes` | string[] | photography, illustration, icons, 3D/CGI, mixed |
| `imageryMoods` | string[] | clean, gritty, warm, cool, minimal, rich, dramatic |
| `fonts.heading` | string | Display/heading typeface |
| `fonts.body` | string | Body copy typeface |
| `fonts.mono` | string | Mono / label typeface |
| `fonts.weights` | string | Font weights in use, e.g. `"400, 600, 700"` |
| `fonts.headingScale` | `large\|medium\|compact` | Heading size preference |
| `brandColors.primary` | hex | CTAs, key actions, brand highlights |
| `brandColors.secondary` | hex | Supporting accents, gradients |
| `brandColors.accent` | hex | Hover states, interactive elements |
| `brandColors.background` | hex | Page/app background |
| `brandColors.surface` | hex | Cards, panels, containers |
| `brandColors.text` | hex | Primary body text |
| `brandColors.textMuted` | hex | Secondary text, captions |
| `brandColors.border` | hex/rgba | Lines, separators |
| `brandColors.success` | hex | Positive states |
| `brandColors.warning` | hex | Cautions |
| `brandColors.error` | hex | Errors, destructive actions |
| `brandColors.notes` | `Record<colorKey, string>` | Usage notes per colour key |

### Comments (unified)

Leave human/agent notes on a client org.

#### `POST /comments` — auth: admin
Body:
```json
{ "orgId": "org_abc", "resourceType": "client_org", "resourceId": "org_abc",
  "body": "Hi @user:uid123, client wants to upgrade to Pro plan.",
  "parentCommentId": null, "attachments": [] }
```

`@user:<uid>` and `@agent:<id>` in body auto-create mention notifications. Denormalised `mentionIds` field enables fast inbox lookups.

#### `GET /comments?orgId=X&resourceType=client_org&resourceId=org_abc` — auth: admin
List comments on this client org. Sorted `createdAt asc`.

#### `PATCH /comments/[id]` — auth: admin
Update body or set `agentPickedUp: true` (sets `agentPickedUpAt` the first time).

### Notifications (client-related)

#### `GET /notifications?orgId=X&type=client.created` — auth: admin
Client-related types: `client.created`, `member.invited`, `member.removed`, `enquiry.received`, `brand.updated`, `onboarding.submitted`.

---

## Workflow guides

### 0. Create a full Cowork space (complete provisioning)

When the user says "create a new Cowork space" or "add a new client", do ALL of these steps. Missing any one of them leaves the space half-functional.

**Admin UI path:** `/admin/clients/new` now defaults to this full provisioning flow for VPS/server-side setup. It creates the PiB/Firebase org, then calls the VPS sidecar to create the mirrored Cowork workspace, Obsidian agent domain, project instructions, and global Cowork mapping. Uncheck "Create full client workspace" only when you deliberately want a Firebase org shell.

**Current agent topology:** do **not** create a Hermes profile per client. PiB uses fixed named agent profiles (`pip`, `theo`, `maya`, `sage`, `nora`) and passes client context by `orgId` per conversation/task. Client setup creates the app org, Cowork workspace, Obsidian domain, instructions, and mappings — not a dedicated Hermes runtime profile.

**Path convention:** local Mac paths use `/Users/peetstander/Cowork/...`; VPS paths mirror the same structure under `/var/lib/hermes/Cowork/...`. For example:

```text
Mac: /Users/peetstander/Cowork/<CLIENT_NAME>
VPS: /var/lib/hermes/Cowork/<CLIENT_NAME>

Mac wiki: /Users/peetstander/Cowork/Cowork/agents/<DOMAIN>
VPS wiki: /var/lib/hermes/Cowork/Cowork/agents/<DOMAIN>
```

The VPS path `/var/lib/hermes/Cowork/Cowork` is a symlink to `/var/lib/hermes/cowork-wiki`.

**Variables used below:**
- `CLIENT_NAME` — display name, e.g. `Deidre Ras Biokinetics`
- `DOMAIN` — kebab-case slug, e.g. `deidre-ras-biokinetics`
- `AGENT_NAME` — short first-name or brand name used as agent identity, e.g. `Deidre`
- `ORG_ID` — returned by step 1 or looked up if org already exists

#### Step 1 — PiB platform org

```bash
POST /organizations
{ "name": "<CLIENT_NAME>", "type": "client", "status": "active" }
# → { id: "<ORG_ID>", slug: "<DOMAIN>" }
```

If the org already exists on the platform (user says so), look it up first:
```bash
GET /organizations   # scan for name/slug match to get ORG_ID
```

#### Step 2 — Obsidian domain

```bash
mkdir -p ~/Cowork/Cowork/agents/<DOMAIN>/{wiki,logs,raw}
```

Write `~/Cowork/Cowork/agents/<DOMAIN>/index.md`:
```markdown
# <CLIENT_NAME> — Knowledge Index

org_id: <ORG_ID>
slug: <DOMAIN>
platform: https://partnersinbiz.online

## Wiki Articles
(none yet)

## Raw Sources
(none yet)
```

#### Step 3 — Workspace folder + subfolders

```bash
mkdir -p ~/Cowork/<CLIENT_NAME>/{docs,briefs,assets,marketing,research,operations,deliverables,inbox,archive}
```

#### Step 4 — Workspace AGENTS.md plus legacy CLAUDE.md mirror

Write `~/Cowork/<CLIENT_NAME>/AGENTS.md` using this template (substitute all placeholders), then write the same content to `~/Cowork/<CLIENT_NAME>/CLAUDE.md` as a legacy mirror for older tooling:

```markdown
# <CLIENT_NAME> — Project Instructions

You are **<AGENT_NAME>**, the dedicated AI agent for **<CLIENT_NAME>** inside Peet Stander's Cowork workspace. Never say you are Claude or any other AI model — you are <AGENT_NAME>.

You assist with strategy, research, planning, writing, content, operations, documentation, execution support, and structured follow-through for the <CLIENT_NAME> project.

Your working directory is `/Users/peetstander/Cowork/<CLIENT_NAME>`.

## Knowledge Base Domain

Your knowledge base lives at: `/Users/peetstander/Cowork/Cowork/agents/<DOMAIN>/`

- On session start, read the hot cache from `~/Cowork/Cowork/agents/<DOMAIN>/wiki/hot.md`
- When you need deeper context: read hot.md first, then index.md, then individual wiki pages
- At session end, update hot.md with a summary of what changed
- Start each session by reading `/Users/peetstander/Cowork/Cowork/agents/<DOMAIN>/index.md`
- When you learn something worth keeping, write to `/Users/peetstander/Cowork/Cowork/agents/<DOMAIN>/wiki/<topic>.md`
- At the end of sessions, write summaries to `/Users/peetstander/Cowork/Cowork/agents/<DOMAIN>/logs/YYYY-MM-DD.md`
- Update `/Users/peetstander/Cowork/Cowork/agents/<DOMAIN>/index.md` when you add new content
- For cross-domain knowledge, write to `/Users/peetstander/Cowork/Cowork/shared/wiki/`
- This is the SAME knowledge base that PiB named agents read and write when handling this client. Keep it current.

## Self-Evolution Rules

You are a self-evolving agent. You:
- Document approaches after complex tasks in the wiki
- Update the wiki when you discover better methods or find stale info
- Save solutions to errors you encounter
- Never leave incorrect knowledge sitting in the wiki

## Wiki Persistence Rules

After completing any significant task or conversation where you learned something new:
1. Update your hot cache at `~/Cowork/Cowork/agents/<DOMAIN>/wiki/hot.md` (overwrite completely, under 500 words)
2. Write a session log to `~/Cowork/Cowork/agents/<DOMAIN>/logs/YYYY-MM-DD.md`
3. If you learned something reusable, write a wiki article and update index.md

Do this proactively. Do not wait to be asked.

## Workspace Organisation

Everything you create goes inside `/Users/peetstander/Cowork/<CLIENT_NAME>`. Never save files to the Desktop, home folder, or anywhere outside your workspace.

- `docs/` — documentation, strategy notes, specs, and durable references
- `briefs/` — task briefs, campaign briefs, requirements, stakeholder instructions
- `assets/` — images, brand files, media, design source files
- `marketing/` — content plans, copy, social/email/web campaigns, publishing calendars
- `research/` — market/person/background research and source synthesis
- `operations/` — admin, SOPs, checklists, process docs, setup notes
- `deliverables/` — final outputs to send, publish, or hand over
- `inbox/` — unsorted incoming material to triage
- `archive/` — stale/superseded material retained for reference

## Behaviour

- Be direct, helpful, and action-oriented
- Peet acts as the board — high-level goals and direction. You execute and recommend
- Default to action over asking permission when the next step is obvious
- When in doubt, create the logical subfolder and put things there
- Do not guess project facts. If the relevant AGENTS.md, CLAUDE.md, or Obsidian notes can be read, read them first
- PiB does not use a dedicated Hermes profile for this project; named agents receive this client via `orgId` context.
```

#### Step 5 — Register in global Cowork context

Add a line to the `Project → Domain Mapping` section in the global Cowork context (`/var/lib/hermes/Cowork/Cowork/global-context.md` on VPS; synced from the Mac-side global instructions):
```
- <CLIENT_NAME> → `agents/<DOMAIN>/`
```

#### Step 6 — Update cowork hot.md

Add the new client to the completed items in `~/Cowork/Cowork/agents/cowork/wiki/hot.md`.

#### Checklist summary

- [ ] PiB org created (or confirmed) — org_id recorded
- [ ] Obsidian domain created: `agents/<DOMAIN>/` with wiki/, logs/, raw/, index.md
- [ ] Workspace folder created: `~/Cowork/<CLIENT_NAME>/`
- [ ] Workspace subfolders created (docs, briefs, assets, marketing, research, operations, deliverables, inbox, archive)
- [ ] `AGENTS.md` written to workspace root
- [ ] `CLAUDE.md` written to workspace root as a legacy mirror
- [ ] Global Cowork Project-to-Domain Mapping updated
- [ ] `cowork/wiki/hot.md` updated

---

### 1. Create a new client end-to-end

```bash
# 1. Create the org
POST /organizations
{ "name": "Acme Corp", "type": "client", "industry": "SaaS", "billingEmail": "billing@acme.com" }
# → { id: "org_abc", slug: "acme-corp" }

# 1b. Confirm/repair platform-owner CRM relationship before downstream work
# Expected: one Company in pib-platform-owner with linkedOrgId=org_abc.
# If missing for existing data, run scripts/backfill-platform-owner-crm-relationships.ts --orgId org_abc first in dry-run, then --commit.

# 2. Set brand profile (optional but recommended before content generation)
PUT /agent/brand/org_abc
{ "brandProfile": { "voice": "confident, warm", "audience": "SMB founders" },
  "brandColors": { "primary": "#1a5fb4" } }

# 3. Set billing details
PUT /organizations/org_abc
{ "billingDetails": {
    "address": { "line1": "...", "city": "...", "postalCode": "...", "country": "ZA" },
    "vatNumber": "...", "phone": "..." } }

# 4. Create login for primary contact
POST /organizations/org_abc/create-login
{ "email": "jane@acme.com", "displayName": "Jane Doe", "role": "owner" }
# Expected: platform-owner Contact linkedUserId=<created uid>, linkedOrgId=org_abc, companyId=<Acme Company id>

# 5. Kick off onboarding (if applicable product)
POST /onboarding
{ "product": "athleet-management", "clubName": "...", "contactEmail": "jane@acme.com", ... }

# 6. Leave an internal note
POST /comments
{ "orgId": "org_abc", "resourceType": "client_org", "resourceId": "org_abc",
  "body": "Created by @agent:pip. Plan: Pro. Billing starts next month." }
```

### 2. Invite and manage team members

```bash
POST /organizations/org_abc/members       # invite
{ "email": "alex@acme.com", "role": "admin" }

PUT /organizations/org_abc/members/user_xyz
{ "role": "member" }                       # demote

DELETE /organizations/org_abc/members/user_xyz
```

### 3. Track enquiries and respond

```bash
GET /portal/enquiries?status=new
PATCH /portal/enquiries/enq_123
{ "status": "replied", "replyNote": "Sent quote on 2026-04-15" }
```

### 4. Update brand profile (agent-driven)

```bash
# Read first — always merge, never clobber
GET /agent/brand/org_abc

# Partial update — only include fields you want to change
PUT /agent/brand/org_abc
{
  "brandProfile": {
    "tagline": "Software your competitors will copy.",
    "toneOfVoice": "Direct, confident, founder-voice.",
    "doWords": ["ship", "build", "craft"],
    "dontWords": ["leverage", "synergy"],
    "designAesthetic": ["minimal", "bold", "dark"],
    "colorMode": "dark",
    "personas": [{ "name": "The Founder", "role": "CEO", "painPoints": "Needs to ship fast" }],
    "competitors": [{ "url": "https://agency.com", "relationship": "differentiate" }],
    "imageryTypes": ["photography"],
    "imageryMoods": ["clean", "warm"],
    "fonts": { "heading": "Instrument Serif", "body": "Geist Sans", "mono": "Geist Mono" }
  },
  "brandColors": {
    "primary": "#F5A623",
    "background": "#0A0A0B",
    "surface": "#141416",
    "text": "#EDEDED",
    "notes": { "primary": "CTAs and key highlights only" }
  }
}
```

### 5. Product onboarding (Athleet)

Public endpoint — used by the public onboarding form on the marketing site:
```bash
POST /onboarding
{ "product": "athleet-management", "clubName": "Blue Bulls", "contactName": "Coach",
  "contactEmail": "coach@bluebulls.com", "contactPhone": "+27...", "memberCount": 80 }
```

## Error reference

| HTTP | Error | Fix |
|------|-------|-----|
| 400 | `name is required` | Provide org name |
| 400 | `Email is invalid` | Check email format |
| 401 | Unauthorized | Check `AI_API_KEY` |
| 403 | Forbidden | User not a member of org |
| 404 | `Organisation not found` | Verify orgId |
| 409 | `Slug "X" already taken` | Choose different name |
| 409 | `Cannot demote last owner` | Promote another member first |

## Agent patterns

1. **Always check `orgId` first** — every create needs it. Ask the user or look up via `GET /organizations`.
2. **Read brand profile before generating content** — `GET /agent/brand/[orgId]` is the source of truth for voice/colours.
3. **Idempotency on client creation** — pass `Idempotency-Key: <uuid>` on `POST /organizations` to avoid duplicates.
4. **Leave a comment after you do something** — `POST /comments resourceType=client_org` so the human sees what the agent did.
5. **Subscribe webhooks** — for notifications on client creation/updates, point an outbound webhook at `contact.created` / `client.created` (see `platform-ops` skill).

## Client Document Handoff

During handoff, account review, or client check-in work, check outstanding `client_documents` for the org. Surface documents in `client_review`, `changes_requested`, `approved`, or `accepted` states, and use the `client-documents` skill when a proposal, spec, report, sign-off, or approval pack is needed.

Onboarding, discovery, market, background, and client-context research belongs in the Research module through the `research-intelligence` skill. Export durable summaries to the client Obsidian domain after meaningful research so PiB agents can reuse the findings.

# Communications Module — WhatsApp Connector Product Spec

Date: 2026-08-06
Status: Draft for engineering (Theo) — approved direction from Peet, not yet released for implementation
Owner: Pip (spec) → Theo (implementation) → Quinn (QA)

## 1. Decision recap (Peet-confirmed 2026-08-06)

- **No unofficial connectors.** whatsapp-mcp / whatsmeow / Web-protocol emulation is explicitly rejected for the multi-tenant platform (ToS risk, number bans, breaks on WhatsApp updates, no delivery guarantees).
- **Official channels only.** WhatsApp is delivered through Meta's WhatsApp Business API, either directly or via Twilio's WhatsApp Business API. Twilio is already the wired provider in the communications module.
- **Product framing.** "Your AI reads your chats and drafts replies" is the product — the transport is official Meta/Twilio, and nothing sends without human approval. Same draft → approve → send pattern already used for Gmail/email.
- **Sequencing.** Ship business WhatsApp first. Personal-number linking is optional in the same release and must ride Meta embedded signup (registers a normal personal number as a business number), never an unofficial protocol.

## 2. Current state (verified against development, 2026-08-06)

Module: `lib/communications/` (born commit bb57fc8d6, 2026-05-28 "organisation messaging console").
API routes: `app/api/v1/communications/` — analytics, automations, campaigns, channels, conversations, live, providers, templates.
UI: `components/communications/CommunicationsConsole.tsx`; portal page `app/(portal)/portal/communications/page.tsx`.

What exists:
- Channels modelled: whatsapp, sms, email, in_app, messenger, instagram.
- Twilio provider (`lib/communications/providers/twilio.ts`) sends WhatsApp + SMS via Twilio client. **Credentials are platform env vars** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_FROM`) — NOT per-org.
- Per-org `ChannelAccount` records: readiness checks, quotas, business hours, sender/phone.
- Conversations + messages with status flow draft → queued → sent → delivered/read/failed.
- **Outbound human-approval already enforced in code**: `app/api/v1/communications/conversations/[id]/messages/route.ts` rejects `sendNow=true` without `humanApproved=true`.
- Templates: WhatsApp categories utility/marketing/authentication (mirror Meta's); provider `approvalStatus`.
- Campaigns: audience (segment/tags/filters), templateId, reply routing, stats.
- Automation: `classifyInboundMessage` (opt_out / opt_in / help_request / balance_request / urgent_support / general_reply) + `buildHermesConversationSuggestion` → `draftReply`, `recommendedOwnerAgentId`, `directSendAllowed: false`.
- Live events route (`/communications/live`).

Confirmed gaps (grep + code inspection 2026-08-06):
1. **No per-org credential store** — multi-tenant onboarding (org connects own Twilio/Meta account) not built.
2. **No inbound webhook receiver** for Twilio/WhatsApp — only outbound + live stream exist.
3. **No agent-suggestion approval UX** in the console.
4. **No Marketing Studio WhatsApp campaign surface** / template submission to Meta.

## 3. Workstream 1 — Business WhatsApp connector (ship first)

Goal: an org can connect its own WhatsApp Business number (Twilio or direct Meta) and its agents can draft replies that a human approves and sends.

### 3.1 Per-org provider credentials + onboarding flow
- Add encrypted per-org credential storage for Twilio (and/or Meta) instead of platform env vars. Platform env vars remain the fallback for the platform's own account.
- `ChannelAccount` gains credential references + connection status: not_connected → connecting → ready → error.
- Onboarding flow (org admin): "Connect WhatsApp Business" → enter/import Twilio credentials or Meta embedded-signup token → verify sender number → readiness checks (reuse existing provider readiness pattern) → save encrypted.
- Credential encryption at rest (existing secret-handling conventions); never echo credentials in API responses, logs, or chat.
- Scope: org-level only for V1 of the connector. Personal-number linking (solo operator) rides Meta embedded signup through the same flow with a lighter UI.

### 3.2 Inbound webhook receiver
- New route under `app/api/v1/communications/` (e.g. `/communications/webhooks/twilio` and/or `/communications/webhooks/whatsapp`) registered per-org.
- Verify Twilio/WhatsApp signature/auth on inbound; parse inbound messages → create/update Conversation + ConversationMessage (status received) for the resolved org.
- Feed inbound through existing `classifyInboundMessage` + routing rules (assign_queue, assign_agent, add_label, set_priority, send_auto_reply, create_task, request_hermes_suggestion).
- Keep the live stream route working; webhook is the durable receive path, live stream is the real-time UI path.
- Status callbacks for outbound delivery (delivered/read/failed) should also land here or the existing statusCallback wiring must be per-org.

### 3.3 Agent-suggestion approval UX in the console
- In the communications console conversation view, show agent-generated drafts (from `buildHermesConversationSuggestion`) as suggestion cards: proposed reply, intent classification, confidence, recommended owner agent.
- Human approves → send (reuses existing `humanApproved` gate), edits, or dismisses. Nothing sends without approval (already enforced server-side; add the UI).
- Suggestion cards carry `mode: 'internal_copilot'` + `directSendAllowed: false` semantics from the schema.

### 3.4 Definition of done (Workstream 1)
- Org admin can connect a Twilio WhatsApp Business sender through the UI; readiness shows ready; credentials encrypted per org; platform env vars still work as fallback.
- Inbound WhatsApp message creates/updates a conversation in the console with correct org scoping.
- Agent suggestion renders in console; approve → send works through Twilio; non-approved messages never send (server gate remains).
- Automated tests: credential lifecycle (encrypt/read/redact), webhook signature + inbound parsing, approval gate regression.
- Evidence: changed files, test output, staging screenshots of onboarding + console approval flow.

## 4. Workstream 2 — Marketing Studio WhatsApp surface (after W1)

Goal: run compliant WhatsApp marketing from Marketing Studio.

- WhatsApp campaign cards (audience, templateId, schedule) using existing campaign model.
- Template submission to Meta: create/review approvalStatus lifecycle (draft → submitted → approved/rejected) per WhatsApp template category (utility / marketing / authentication).
- Compliance: marketing sends require Meta-approved templates + opted-in contacts; free-form messages only inside the 24-hour customer-service session window. Opt-out handling via existing `classifyInboundMessage` (opt_out).
- Definition of done: campaign create/preview/schedule through Marketing Studio, template approval status visible, opt-out flows back into routing rules, stats surface sends/delivered/read/replies/optOuts.

## 5. Sequencing & dependencies

- W1 is the critical path (make business WhatsApp live: connect → receive → draft/approve/send).
- W2 depends on W1 (needs live connector + templates) but its UI/template-submission surface can be built in parallel.
- QA (Quinn) after W1; full QA + Peet review before any production promote.

## 6. Gates (remain closed unless Peet explicitly opens)

- No production deploy / release promotion.
- No client-visible sends during development (test numbers only).
- No paid spend on Twilio/Meta beyond existing platform account usage.
- No credential exposure in chat/wiki/logs; encrypted storage only.
- Personal-number linking ships only via Meta embedded signup (official API).

## 7. References

- Skill: `pib-communications-module-operations` (+ `references/whatsapp-implementation-review-2026-08-06.md`)
- Repo: `lib/communications/`, `app/api/v1/communications/`, `components/communications/CommunicationsConsole.tsx`
- Source conversation: UCI0tYXmZCTb3zvcTfGF

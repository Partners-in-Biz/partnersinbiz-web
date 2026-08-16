# Org Twilio (BYOK) — SMS, WhatsApp, Voice, Lookup, Verify

Each organisation connects its own Twilio account under **Communications → Channels → Organisation Twilio (BYOK)**.

## What orgs store (encrypted)

- Account SID + Auth Token (required)
- Messaging Service SID and/or default SMS from number
- WhatsApp from number
- Voice caller ID
- API Key SID + Secret (softphone Access Tokens)
- TwiML App SID (Voice Request URL → `/api/v1/twilio/voice/webhook?orgId=…`)
- Verify Service SID (OTP)

Plaintext config on the same doc: `recordCallsByDefault`, `inboundNumbers`.

## Product surfaces

| Capability | API | UI |
|---|---|---|
| Save / status | `GET/PUT /api/v1/twilio/settings` | Communications Channels |
| Softphone token | `POST /api/v1/twilio/voice/token` | CRM contact click-to-call |
| Voice webhooks | `/api/v1/twilio/voice/{webhook,status,recording}` | Twilio Console |
| Call history | `GET /api/v1/twilio/calls` | CRM activity + `twilio_calls` |
| Lookup | `POST /api/v1/twilio/lookup` | API |
| Verify OTP | `POST /api/v1/twilio/verify` (`action: send\|check`) | API |
| SMS | existing SMS routes; prefers org credentials | CRM / sequences |

## Call → agent context

Outbound/inbound calls write `twilio_calls` and upsert a CRM `activities` row (`type: call`) with recording URL, transcript, and summary when available. Dual-channel recording is on by default; transcription is requested after the recording callback.

## Twilio Console checklist

1. Buy/port numbers on the **org** Twilio account.
2. Create API Key + TwiML App; Voice URL = platform voice webhook with `orgId`.
3. Paste secrets into PiB Twilio settings (never platform env for client orgs).
4. Optional: Verify Service for OTP; enable Conversation Intelligence for richer transcripts.

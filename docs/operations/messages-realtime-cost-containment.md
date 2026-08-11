# Messages realtime cost containment

## Architecture

Messages uses the GCP-native invalidation path for realtime updates:

`Firestore transaction -> realtime_outbox -> Firebase Function -> Pub/Sub -> Cloud Run gateway -> authenticated WebSocket -> canonical HTTP read`

The WebSocket frame carries only `eventId` and `conversationId`. It never
contains a message body, tool output, attachment URL, organisation data,
runtime detail, or credential. The browser always re-fetches the affected
conversation through the normal permission-checked API.

When `NEXT_PUBLIC_CONVERSATION_REALTIME_TRANSPORT=enabled` and the WebSocket
has authenticated, the old `/api/v1/conversations/live` SSE poll is closed.
If the gateway is unavailable, the SSE path reconnects automatically so chat
does not lose updates.

## Cost controls

- Gateway invalidations refresh one conversation rather than re-reading the full rail.
- The active transcript reloads only when that active conversation changes.
- A running background tab reloads only on its own invalidation. If every
  gateway connection is unavailable, the bounded fallback reads one snapshot
  per stream instead of rescanning the rail inside the 55-second stream.
- Presence heartbeats acknowledge their own write without listing the full
  presence collection again.

When the gateway is still in unproven `shadow` mode, set both transport flags
to `off`. Shadow keeps the Firestore fallback authoritative while also paying
for the WebSocket path, so it must be reserved for a time-boxed canary.

## Safe production activation order

1. Deploy the Firebase Function publisher so deliveries include `conversationId`.
2. Build and deploy `services/realtime-gateway` to Cloud Run.
3. Confirm the gateway health endpoint and an authenticated browser WebSocket canary.
4. Set both `CONVERSATION_REALTIME_TRANSPORT=enabled` and
   `NEXT_PUBLIC_CONVERSATION_REALTIME_TRANSPORT=enabled` on the Vercel
   production environment, retaining the configured gateway URL.
5. Deploy Vercel production, then verify an active browser stops opening the
   SSE endpoint after receiving the WebSocket `ready` frame.

Rollback is configuration-only: redeploy with the public transport set to
`shadow` or `off`. The SSE fallback becomes authoritative immediately.

## Verification

Use the production read-audit logs to compare these scopes before and after:

- `api/v1/conversations/live/snapshot`
- `api/v1/conversations/:id/messages:get`
- `api/v1/conversations/:id/presence:post`

The expected steady-state result is no recurring live-snapshot reads while the
gateway is healthy, and message reads only when a specific conversation changes.

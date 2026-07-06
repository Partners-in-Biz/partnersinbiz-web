# Creative Canvas fal.ai BYOK connection and smoke runbook

Date: 2026-07-06
Owner: Theo
Reviewer: Quinn / qa-release
Org scope: `pib-platform-owner`
Risk: High — secret/config handling plus possible provider spend

## Purpose

This runbook closes the remaining fal.ai proof gap from the Creative Canvas multi-provider BYOK rollout. xAI BYOK has a real end-to-end artifact; fal.ai currently has only endpoint-slug evidence (`401 auth-required`, not `404`) and still needs a credentialed smoke.

## Hard gates

Do not proceed past read-only checks unless all of these are true:

1. Peet explicitly approves adding or rotating a fal.ai credential for `pib-platform-owner`.
2. Peet explicitly approves one minimal paid fal.ai image generation smoke.
3. The fal key is supplied through an approved local/staging secret channel only.
4. No raw key is pasted into chat, wiki, docs, task comments, shell history, or screenshots.
5. Production env/secrets are not changed unless Peet separately approves a production secret change.

## Evidence to capture

Capture only masked/non-secret evidence:

- Current connection readback for `org:pib-platform-owner:fal`.
- fal slug probes for:
  - `fal-ai/flux-2-pro`
  - `fal-ai/kling-video/v2.6/pro/text-to-video`
  - `fal-ai/veo3.1`
- POST connection result with `status=connected`, `hasCredentials=true`, and masked `credentialHint`.
- GET/list readback showing no `credentialsEnc` or raw secret in the API response.
- DELETE/revoke result showing the connection can be revoked safely.
- Reconnect result before generation.
- One `fal-flux-2-pro` Creative Canvas generation returning a real artifact URL.
- Run provenance showing `costUnits=0`, `costLabel=byok:fal`, and `connectionId=org:pib-platform-owner:fal`.
- A no-spend video eligibility note from unauthenticated slug probes only, unless Peet separately approves a video spend.

## Local/staging smoke command

The repo now exposes a gated script:

```bash
npm run smoke:creative-canvas-fal-byok
```

By default it targets `http://localhost:3010/api/v1`; set `PIB_API_BASE` to a staging API URL when testing a staging deployment.

With no approval token it stays read-only: slug probes + existing masked connection readback only when the selected API already exposes the BYOK routes.

After approval, run from the development checkout with env values injected by the approved secret store:

```bash
PIB_API_BASE="http://localhost:3010/api/v1" \
PIB_AGENT_API_KEY="${PIB_AGENT_API_KEY}" \
PIB_FAL_BYOK_SMOKE_ORG_ID="pib-platform-owner" \
PIB_FAL_BYOK_SMOKE_KEY="${APPROVED_FAL_KEY}" \
PIB_FAL_BYOK_SMOKE_APPROVED="YES_I_APPROVE_PAID_FAL_SMOKE" \
npm run smoke:creative-canvas-fal-byok
```

Optional controls:

- `PIB_FAL_BYOK_SMOKE_SKIP_REVOKE=1` skips the revoke/reconnect check. Use only if Peet wants to preserve an existing connection without interruption.
- `PIB_FAL_BYOK_SMOKE_MODEL=fal-flux-2-pro` is the default minimal image model.
- `PIB_FAL_BYOK_SMOKE_TIMEOUT_MS=180000` and `PIB_FAL_BYOK_SMOKE_POLL_MS=5000` control polling.

## Expected pass shape

The final script line should say:

`PASS: fal.ai BYOK connection, masked readback, revoke/reconnect, slug eligibility, and minimal image generation were verified.`

The final run summary must show:

```json
{
  "status": "completed",
  "output": { "url": "https://..." },
  "provenance": {
    "costUnits": 0,
    "costLabel": "byok:fal",
    "connectionId": "org:pib-platform-owner:fal"
  }
}
```

## Rollback

If the smoke fails after connecting the key:

1. Revoke `org:pib-platform-owner:fal` through the Creative providers UI or `DELETE /creative-canvas/connections/org%3Apib-platform-owner%3Afal?orgId=pib-platform-owner`.
2. Remove any local/staging injected test key from the approved secret store.
3. Leave the failed run/canvas as internal evidence unless policy requires test artifact deletion.
4. Record the provider response/status without exposing the raw key.

## Reviewer checklist

Quinn should verify:

- The gate prevented paid/write actions before approval.
- No raw fal key appears in docs, wiki, shell output, task output, or API responses.
- Connection readback is masked and tenant-scoped to `pib-platform-owner`.
- Revocation works or was intentionally skipped with approval.
- Image generation returns a real fal artifact and BYOK provenance.
- Video endpoints were only eligibility-probed with no spend unless separately approved.

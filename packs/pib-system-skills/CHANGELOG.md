# Changelog

## 0.1.1 — 2026-07-23

- Add user-scoped agent delegation token route (`POST /api/v1/agent/delegations`)
- Resolve `pib_dlg_…` Bearer tokens as the acting human in API auth
- Add auth tests and expose delegations in `/api/v1/agent` manifest
- Clarify `system-auth` rollout language: implemented in app code; available after deployment

## 0.1.0 — 2026-07-23

- Initial system skills pack staged at `partnersinbiz-web/packs/pib-system-skills`
- Tiers: `core` (14) + `growth` (10)
- New `system-auth` skill (user-delegation for interactive; system key for cron)
- Client-documents golden + invalid contract fixtures
- `bin/pib-skills` installer/status/verify-contracts
- User-delegation auth spec (`docs/user-delegation-auth.md`)
- Locked decisions: dedicated repo target, env pin + stable channel, core+growth scope

# Changelog

## 0.1.2 — 2026-07-23

- Consolidate ~21 `marketing/ads-*` Claude skills into 3 tiered umbrella
  skills: `marketing/ads-strategy` (plan, budget, math, audit, competitor,
  test), `marketing/ads-platforms` (google, meta, linkedin, microsoft,
  tiktok, youtube, apple deep audits), and `marketing/ads-creative` (brand
  DNA, campaign briefs, image generation, photoshoots, landing pages,
  creative-fatigue audit)
- `ads-manager` (PiB platform API skill) unchanged and remains the sole
  ads-related skill in this pack
- `agents.ads` and `agents.maya` runtime policy now load the 3 umbrella
  skills instead of ~21 individual `marketing/ads-*` entries; old skill
  folders remain on disk for one release as reference only
- Split the `platform-ops` mega-skill (~1662 lines) into focused skills:
  `agent-runtime-ops` (Hermes profile links/controls, agent registry/admin,
  agent memory, Loop Engine internals, runtime/provider health, linked
  computers — owner theo, critical risk), `platform-admin-users` (Platform
  Users super-admin CRUD — owner pip, critical risk), and `reports`
  (snapshot + ad-hoc report queries — owner data, medium risk)
- Moved Book Studio / YouTube Studio / Creative Canvas bridge content out of
  `platform-ops` and into the existing `book-studio-ops`, `youtube-studio-ops`,
  and `creative-canvas-ops` stubs, deepening them with real route
  documentation
- Folded FX Rates into `billing-finance` as a short section with an auth
  pointer
- `platform-ops` now opens with a "Related skills" index pointing at the
  splits; trimmed from ~1662 to ~770 lines
- Bump `packVersion`/`catalogVersion` to `0.1.2` alongside the ads-skill
  consolidation wave

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

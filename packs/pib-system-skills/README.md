# pib-system-skills

Versioned **Partners in Biz system skills pack** — the canonical how-to for agents operating the PiB SaaS (`/api/v1/*`).

## Why this exists

Agents on Mac, VPS, and client machines were loading **different / stale** skill trees from partial repo mirrors. That produced wrong API payloads and false “done” claims. This pack is the single release channel.

## Decisions (locked 2026-07-23)

| Decision | Choice |
| --- | --- |
| Repo | `Partners-in-Biz/pib-system-skills` (this pack; initially staged under `partnersinbiz-web/packs/`) |
| Interactive auth | **User-delegation tokens** scoped to the requesting human |
| System auth | Platform/agent keys for **cron only** |
| Versioning | Semver + env pin; `stable` channel alias |
| Tiers | `core` (SaaS ops) + `growth` (social/SEO/ads/research) |

## Quick start

```bash
# From this pack root:
./bin/pib-skills status
./bin/pib-skills install core          # or: all | growth
./bin/pib-skills verify-contracts
```

Default install destination is **Hermes**: `~/.hermes/skills` (+ `~/.hermes/skills/partnersinbiz/*`), overridable via `PIB_SKILLS_DEST`. Claude is a separate, explicitly-maintained mirror at `partnersinbiz-web/.claude/skills/**` (kept byte-identical to `skills/**` in this pack) — it is not the pack's install target.

## Layout

```
manifest.json          # version, tiers, per-skill metadata
skills/*/SKILL.md      # agent skills
contracts/             # golden + invalid API payloads
bin/pib-skills         # installer / status / verify
docs/                  # auth, distribution, contribution
```

## Verification contract

Every write skill must:

1. Write
2. Read back
3. Assert non-empty / expected state
4. Only then report URL/id
5. On 4xx, print `error` — never spawn duplicate empty shells

## Related

- Platform policy (runtime allowlists): `partnersinbiz-web/config/agent-skill-policy.json`
- Plan: Cowork wiki `pib-system-skills-pack-plan-2026-07-23`

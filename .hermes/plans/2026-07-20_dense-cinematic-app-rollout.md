# Dense Cinematic Minimal — App-wide Rollout (Hermes plan)

Canonical long-form plan: `docs/plans/dense-cinematic-app-rollout-2026-07-20.md`  
Design lock: `docs/design-language.md`

## Intent

Propagate the live Messages UI (PR #119) across **all** portal + admin pages:

- Dense, minimal chrome (no wasted space, no big buttons)
- Pop of colour via module accents only
- Shared components first; pages only compose the kit
- Atmosphere tiers: 0 quiet · 1 glass · 2 field (WebGL rare)

## Phases (execute in order)

0. Design lock ✅  
1. Extract kit from Messages (tokens, NeuralField, ModuleShell, HudChip, btn-pib-sm)  
2. Upgrade AppFoundation (PageHeader, Surface glass/quiet, StatCard, dense EmptyState)  
3. Portal + admin shell chrome  
4. Module waves: CRM → Dashboard → Projects → Analytics → Email → Social → SEO → Settings → Agents → Studios chrome → Admin system → leftovers  
5. Immersive tier-2: Briefings, Mission Control, agent runs  
6. Visual QA + optional lint ratchet  

## First build slice (when implementation starts)

1. Promote `--pib-fx-*` tokens + `.pib-glass` + `.btn-pib-sm`  
2. Move atmosphere components to `components/ui/atmosphere/`  
3. Rewire HermesMessagesShell to kit (parity)  
4. Dense PageHeader + Surface variants  
5. Layout chrome  
6. CRM wave as proof  

## Out of scope

Public marketing, email HTML, creative-canvas internals, campaign-preview mockups, client-document public themes.

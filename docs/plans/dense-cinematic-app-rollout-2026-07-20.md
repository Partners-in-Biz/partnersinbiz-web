# Dense Cinematic Minimal — App-wide Rollout Plan

**Date:** 2026-07-20  
**Design lock:** `docs/design-language.md` (Dense Cinematic Minimal)  
**Reference:** Messages PR #119 / `components/messages/atmosphere/*`  
**Goal:** Bring the Messages look (materials + density + colour pop) to **every** admin + portal page via **shared components**, without wasting space or growing button chrome.

---

## 1. Success criteria

A page is “done” only when **all** are true:

1. **Primitives only** for header, surfaces, buttons, pills, empty/loading, dialogs.
2. **Dense:** desktop controls ≤ 32–36px height; no oversized hero padding; no double card frames.
3. **Module colour pop** on icons / active states / key stats (accent map).
4. **Dark + light** readable.
5. **No logic regressions** (tests for that surface still pass).
6. **Atmosphere tier correct** (0 quiet / 1 glass / 2 field) — no WebGL on CRUD lists.

Definition of done for the **program**: portal + admin routes (≈346 `page.tsx` files) either restyled or explicitly excluded; shared UI kit owns glass/HUD/density tokens.

---

## 2. Strategy: components first, pages second

```
Phase 0  Design lock + inventory          ✅ (this plan)
Phase 1  Extract kit from Messages        tokens + ui/atmosphere + btn-sm defaults
Phase 2  Upgrade AppFoundation primitives PageHeader, Surface, StatCard, chips
Phase 3  Shell chrome                     portal + admin layouts, nav, command palette
Phase 4  Module waves                     CRM → Analytics → Email → Social → …
Phase 5  Immersive workspaces             Briefings, Mission Control, agent runs (tier 2)
Phase 6  Hardening                        visual QA matrix, ratchet, docs
```

**Rule:** During page waves, agents may only **compose** kit primitives. If a pattern is missing, extend the kit first (small PR), then restyle pages.

---

## 3. Phase 1 — Extract the Messages kit (foundation PR)

### 3.1 Token promotion

Lift from `messages-experience.css` into `app/globals.css` (or `styles/pib-fx.css` imported once):

| Token | Purpose |
|---|---|
| `--pib-fx-glass` / `--pib-fx-glass-strong` | Translucent surfaces |
| `--pib-fx-line` / `--pib-fx-line-hot` | Hairlines |
| `--pib-fx-glow-{accent,violet,cyan}` | Soft glows |
| `--pib-fx-blur` / `--pib-fx-sat` | Backdrop defaults |
| `--pib-control-height` | Confirm **2rem (32px)** app default |
| `--pib-control-height-touch` | 2.75rem where required |

Add utilities:

- `.pib-glass` — glass fill + blur  
- `.pib-shell` — primary workspace frame (tier 1–2 host)  
- `.pib-accent-edge` — 2px module spectral rail  
- `.pib-enter` — scroll-driven enter (with fallback)  
- `.pib-live-surface` — activity shimmer  
- `.btn-pib-sm` — h-7 / text-xs compact control (**preferred in app**)

### 3.2 Component extraction

| New / moved | API sketch |
|---|---|
| `components/ui/atmosphere/NeuralField.tsx` | Move from Messages; props: `intensity`, `paused` |
| `components/ui/atmosphere/CssAurora.tsx` | Fallback mesh |
| `ModuleShell` | `tier: 0\|1\|2`, `accent`, children; hosts field when tier=2 |
| `HudChip` | compact meta chip |
| `GlassBar` | sticky/top glass strip |
| `SignalMeter` | optional decorative/live meter |
| `StatCard` | compact KPI using module soft glow |

### 3.3 Messages migration

Rewire `HermesMessagesShell` to consume kit primitives so Messages remains the reference **without** a private CSS island. Keep `data-messages-experience` as a thin alias or replace with `data-pib-shell`.

### 3.4 Exit criteria

- Visual parity on `/portal/messages` after extraction.
- Focused Messages + foundation tests green.
- No production promotion required until Phase 2–3 batch is ready (or ship foundation alone if stable).

---

## 4. Phase 2 — Foundation density pass

Update existing primitives (do not create parallel APIs):

| Primitive | Change |
|---|---|
| `PageHeader` | Tighter gaps; optional `accent` spectral underline; denser actions row using `btn-pib-sm` |
| `PageTabs` / `PageLinkTabs` | Smaller tab height; module active underline/glow |
| `Surface` | Add `variant="glass" \| "quiet"`; `accentEdge?: ModuleHue` |
| `EmptyState` | Default compact; optional `dense` |
| `StatusPill` | Align with `HudChip` sizing |
| `DialogDrawer` | Glass header/footer; sm actions |
| `Button.tsx` / CSS buttons | Document sm as app default; md reserved |

Add a Story/demo route **only if** one already exists; otherwise a private `/admin/...` gallery is optional — prefer dogfood on real pages.

---

## 5. Phase 3 — App shells (highest leverage)

Restyle once; every page inherits.

| Surface | Work |
|---|---|
| Portal layout / nav | Dense nav items, icon tints, glass mobile drawer |
| Admin layout / nav | Same kit; cyan system accent |
| Command palette | Glass panel + compact rows |
| Toasts | Compact, accent edge by tone |
| Global dialogs | Shared drawer chrome |

**Exit:** Navigate 5 portal + 5 admin routes; chrome already feels like Messages without page work.

---

## 6. Phase 4 — Module waves (every page)

Work **by module family** so accent colour stays coherent. Each wave = kit-only class/markup restyle + smoke tests.

### Wave order (recommended)

| # | Module | Accent | Approx. surface | Notes |
|---|---|---|---|---|
| 4.1 | **CRM** (companies, contacts, deals, quotes, segments, capture) | Amber | High traffic | Align with CRM hub density |
| 4.2 | **Dashboard / home / first-run** | Amber/cyan | First impression | Quiet tier 0–1 |
| 4.3 | **Projects / tasks / kanban / documents** | Cyan | Dense boards | Compact columns |
| 4.4 | **Analytics / reports** | Violet | Charts keep strokes | No card rainbow |
| 4.5 | **Email / broadcasts / sequences / communications / mailbox** | Blue | Large surface area | Reuse list + composer glass |
| 4.6 | **Social / campaigns / content / ads chrome** | Rose | Exclude campaign-preview mockups | |
| 4.7 | **SEO / geo-seo** | Green | | |
| 4.8 | **Billing / settings / branding / data / properties** | Cyan | Forms density | |
| 4.9 | **Agents / linked computers / hermes admin** | Cyan + signal | Near Messages language | |
| 4.10 | **Studios chrome** (video, book, youtube, mobile apps) **excluding** creative-canvas internals | Rose/cyan | Toolbars glass tier 1 | |
| 4.11 | **Admin system** (org admin, governance, support, tools) | Cyan | | |
| 4.12 | **Leftovers sweep** | — | grep for bulky patterns | |

### Per-page checklist (agent)

```
[ ] Uses PageHeader / Surface / btn-pib-sm / StatusPill|HudChip
[ ] Module accent on icons + active tab + 1–2 KPIs
[ ] No h-12+ app buttons; no nested card shadows
[ ] Padding densified (p-3/p-4)
[ ] Empty/loading via primitives
[ ] Light theme spot-check
[ ] Relevant Jest still passes
```

### Bulk detectors (run each wave)

```bash
# Bulky controls / spacing leftovers
rg -n "h-12 |h-14 |text-3xl|p-8 |space-y-10|space-y-12|rounded-3xl" app/\(portal\) app/\(admin\) components --glob "*.tsx"

# Not using foundation header yet
rg -L "PageHeader|pib-page-title" app/\(portal\) --glob "**/page.tsx"

# Missing colour pop candidates (icon rows without tint)
rg -n "material-symbols-outlined" components/crm --glob "*.tsx" | rg -v "pib-icon-tint" | head
```

---

## 7. Phase 5 — Immersive workspaces (tier 2)

Only after kit is stable:

| Workspace | Action |
|---|---|
| Messages | Already gold standard — keep parity tests |
| Briefings | Adopt `ModuleShell` tier 2 + dense controls |
| Mission Control | Tier 2 field optional; HUD chips for live ops |
| Agent run session | Live shimmer bound to real run state |
| Communications console | Tier 1–2 hybrid |

Bind decorative meters to **real** signals where cheap (online agents, run streaming); otherwise keep static/soft animation.

---

## 8. Phase 6 — Hardening

1. **Visual QA matrix** (human or browser harness): Messages, CRM list/detail, Analytics overview, Email, Projects board, Settings, Admin org home — dark + light, 390 / 768 / 1280 / 1440.
2. **Ratchet:** optional ESLint/custom check forbidding `h-14` buttons in `app/(portal|admin)` and `components/**` (allowlist marketing).
3. **Docs:** keep `design-language.md` + this plan updated; close tracker rows.
4. **Production:** promote in batches (foundation+shell, then module waves) — not one mega-PR if risk is high.

---

## 9. Explicit non-goals

- Redesigning public marketing site.
- Recoloring creative-canvas engine or campaign-preview mockups.
- Adding WebGL to every page.
- Increasing whitespace “for premium feel” (premium = materials + density, not emptiness).
- New feature logic while restyling.

---

## 10. Effort model (planning only)

| Phase | Nature | Suggested shipping unit |
|---|---|---|
| 1 Kit extract | 1–2 focused PRs | development → Preview dogfood Messages |
| 2 Foundation | 1 PR | |
| 3 Shells | 1 PR | high leverage |
| 4.x Modules | 1 PR per wave (or half-wave if huge) | parallelizable after kit |
| 5 Immersive | 1 PR each | |
| 6 Harden | 1 PR | |

Rough surface counts: ~199 portal pages, ~147 admin pages, hundreds of components — **kit + shell is ~80% of perceived consistency**; page waves clean the long tail.

---

## 11. First implementation tasks (ready to execute)

1. **P0** — Token + utility extraction (`--pib-fx-*`, `.pib-glass`, `.btn-pib-sm`).
2. **P0** — `NeuralField` / `ModuleShell` / `HudChip` under `components/ui/`.
3. **P0** — Rewire Messages to kit; parity test.
4. **P1** — `PageHeader` + `Surface` density/glass variants.
5. **P1** — Portal + admin layout chrome.
6. **P2** — CRM wave (amber) as the first full module proof.
7. **P2** — Dashboard + Projects waves.
8. Continue 4.x order above.

---

## 12. Decision log

| Decision | Choice | Why |
|---|---|---|
| Density vs air | **Density** | Board direction: no wasted space; Messages is the proof |
| Buttons | **Small pills default** | No big buttons |
| Colour | **Module pop only** | Avoid AI rainbow / large fills |
| WebGL | **Tier 2 only** | Cost + distraction on CRUD |
| Approach | **Reuse components** | One kit, many pages |
| Messages CSS island | **Extract then delete island** | Single source of truth |

---

## 13. Approval gate

This plan is documentation only until implementation starts on `development`.  
Production promotions remain explicit per batch.

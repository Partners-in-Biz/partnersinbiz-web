# Design Audit engine (Impeccable-style deterministic rules)

Dependency-free TypeScript port of the Apache-2.0 Impeccable detector rule set
(impeccable.style) for Partners in Biz. Built for task T1 of project
`2ZybgdBFW3un2Rt6pq0Y` — the engine that powers the Design Audit action card
in Messages (T2) and slop-blocking hooks (T4).

## What it does

Runs 30 deterministic core rules over HTML/JSX/TSX/Vue/Svelte/Astro source
(plus raw CSS, wrapped as a `<style>` block), grouped P0-P3, with element refs,
plus 4 design-system-drift rules that activate only when a per-client
Design Context (DESIGN.md / .impeccable/design.json) is supplied.

Exit codes: `0` clean, `2` findings, `1` failure. JSON output schema
`pib-design-audit/v1`.

## CLI

```
npx tsx scripts/design-audit.ts <file|dir|stdin> [--json] [--scope type|layout]
    [--design-context DESIGN.md|design.json] [--no-design-system]
    [--ignore-rule <id>]... [--ignore-value <rule:value>]... [--ignore-file <glob>]...
    [--no-inline-ignores] [--no-config] [--max-findings-per-rule <n>]
```

Examples:

```
npx tsx scripts/design-audit.ts --json page.html
npx tsx scripts/design-audit.ts --scope type --design-context DESIGN.md src/
cat component.css | npx tsx scripts/design-audit.ts
```

`.impeccable/config.json` is honored when present:
`{ "detector": { "ignoreRules": [], "ignoreFiles": [], "ignoreValues": [], "designSystem": { "enabled": true } } }`

## Programmatic API

```ts
import { runAudit, parseDesignMd } from '@/lib/design-audit'

const result = runAudit(htmlSource, {
  scope: 'all',
  designSystem: parseDesignMd(mdSource),
  ignore: { rules: ['buzzwords'], values: ['overused-fonts:Inter'] },
  runtimeErrors: browserConsoleErrors,   // browser mode
  computedStyles: refToComputedStyleMap, // browser mode
})
// result.exitCode, result.summary.bySeverity, result.findings[]
```

## Rule catalogue (30 core + 4 drift)

AI-slop tells (15): `purple-gradients`, `glassmorphism`, `gradient-text`,
`dark-glow`, `bounce-easing`, `side-tab-borders`, `border-accent-rounded`,
`nested-cards`, `icon-tile-stacks`, `kicker-eyebrow`, `italic-serif-hero`,
`overused-fonts`, `flat-type-hierarchy`, `em-dash-overuse`, `buzzwords`.

Quality basics (12): `missing-document-lang`, `broken-images`, `missing-alt`,
`unlabeled-controls`, `script-errors` (browser runtime errors),
`content-invisible-at-rest`, `cramped-padding`, `long-line-length`,
`tight-line-height`, `wide-letter-spacing`, `justified-text`.

WCAG + a11y (4): `low-contrast-text` (4.5:1 body / 3:1 large), 
`skipped-heading-levels`, `tiny-body-text` (<12px), 
`undersized-functional-text` (<11px).

Design-system drift (4, DESIGN.md-gated): `font-outside-design`,
`color-outside-design`, `radius-outside-design`, `font-size-outside-design`.

## Ignore support (impeccable-disable equivalent)

- Comment: `<!-- impeccable-disable -->` / `<!-- impeccable-disable rule1 rule2 -->`,
  re-enabled by `<!-- impeccable-enable [rules] -->`.
- Line forms: `<!-- impeccable-disable-line rule -->`,
  `<!-- impeccable-disable-next-line rule -->`.
- Per-element / subtree (per-value equivalent):
  `<div data-impeccable-disable="purple-gradients,glassmorphism">`.
- Options: `ignore.rules`, `ignore.values` (`rule:value` or bare value),
  `ignore.files` (globs), `ignore.inline` (default true).

## DESIGN.md / design.json context

DESIGN.md (Google Stitch-ish shape, like /impeccable document):

```
## Colors
- Primary: #0F172A
- #64748B

## Typography
- Display: "Space Grotesk"
- Inter

## Radii
- sm: 4px
- 8px

## Font Sizes
- 12px, 14px, 16px, 20px
```

or `.impeccable/design.json`:
`{ "palette": ["#0f172a"], "fonts": ["Inter"], "radii": [4, 8], "fontSize": [12, 14, 16] }`

## Browser mode (T2)

Pass `runtimeErrors` (console errors) and `computedStyles` (map of element
path → computed CSS properties) to get checks that need real layout:
`script-errors`, `low-contrast-text` with inherited colors, and font-size /
line-height / padding checks against computed values instead of heuristics.
Refs match `pathOf()` output so the audit card can overlay findings onto a
screenshot.

## Scope

`--scope type` runs type-tagged + `any` rules (typography, hierarchy, copy);
`--scope layout` runs layout-tagged + `any` rules (surfaces, spacing, media).
`any` rules (e.g. `low-contrast-text`) always run.

## Slop-blocking hooks (gate)

The detector is wired into the development workflow as a gate — any UI change
that introduces P0/P1 findings fails the gate, so slop can't silently land.

Two-speed reporting (mirrors Impeccable's own hook design):

- **Light per-edit pass** (pre-commit hook): runs on staged UI files only
  (`.html .jsx .tsx .vue .svelte .astro .mdx .css`), blocks on P0/P1 findings,
  P2/P3 advisory. Fast, so it doesn't make agents over-conservative.
  - Install: `npm ci`/`npm install` runs `scripts/install-design-hooks.mjs`
    which sets `core.hooksPath=.githooks` for this checkout (local config
    only). Or run `npm run prepare` manually.
  - Overrides: `git commit --no-verify` (manual), `IMPECCABLE_SKIP_HOOK=1`
    (tooling). Prefer fixing or an explicit inline ignore.
- **Deep pass at completion** (CI): `scripts/design-audit-gate.ts --deep
  --base <sha>` runs on every push/PR to `development` in
  `.github/workflows/ci.yml`; reports all severities, blocks on P0/P1, P2/P3
  advisory. CI runs on `development` only — never `main`.

Usage:

```
npx tsx scripts/design-audit-gate.ts --light --staged          # pre-commit
npx tsx scripts/design-audit-gate.ts --deep --base origin/development  # CI / completion
npx tsx scripts/design-audit-gate.ts --file page.tsx --json    # explicit files
```

Exit codes: `0` pass / `2` blocked (P0/P1) / `1` failure. The gate always
prints a verdict line, even when zero files were scanned — silence can never
read as clean.

**Doctor** (`/impeccable doctor` equivalent): `npm run design:doctor` verifies
the engine works, the hook is installed and executable, CI has the deep pass,
and the Studio artifact gate is wired. It always prints an explicit PASS/FAIL
and exits 1 on any failure.

**Studio artifact gate**: `lib/design-audit/studio.ts` runs the detector over
HTML-like payloads in creative-canvas node data when a graph is saved
(`PUT /api/v1/creative-canvas/[id]/graph`). P0/P1 findings are stamped into
`node.data.designAudit` (auto-comment back into the artifact) and returned in
the response so the agent fixes them before marking the task complete. Studio
saves are advisory (never hard-blocked mid-iteration) — the repo gate is the
hard gate.

/**
 * Named design commands in Messages (P1, project 2ZybgdBFW3un2Rt6pq0Y).
 *
 * The Impeccable-style design vocabulary surfaced to users as first-class
 * slash commands (/polish, /typeset, /layout, /colorize, /bolder, /quieter,
 * /distill, /clarify, /harden, /audit, /critique). Every command maps to:
 *
 *  - a prompt template (the discipline the agent must run), and
 *  - a T1 design-detector scope (--scope type|layout) so the agent runs the
 *    right checks, and
 *  - the T3 per-client Design Context which the agent must resolve and cite.
 *
 * Every named command MUST resolve the client's Design Context (T3) and run
 * the detector (T1) before AND after the intervention.
 *
 * This module is intentionally pure (no firebase/server imports) so the same
 * registry drives the composer action menu (mobile fallback) and the server
 * prompt builder.
 *
 * Upstream: Impeccable (Apache 2.0, pbakaus/impeccable) — see
 * research item ZTTo7g6CU80u1uUSZvoC recommendation P1.
 */

export type DesignDetectorScope = 'type' | 'layout' | 'all'

export type DesignCommandId =
  | 'polish'
  | 'typeset'
  | 'layout'
  | 'colorize'
  | 'bolder'
  | 'quieter'
  | 'distill'
  | 'clarify'
  | 'harden'
  | 'audit'
  | 'critique'

export type DesignCommandCategory =
  | 'evaluate'
  | 'refine'
  | 'simplify'
  | 'harden'

export interface DesignCommandDefinition {
  id: DesignCommandId
  token: string
  label: string
  description: string
  aliases: string[]
  icon: string
  /** T1 detector narrowing: --scope type|layout (any rules always run). */
  scope: DesignDetectorScope
  category: DesignCommandCategory
  /** Discipline lines injected into the agent prompt. */
  promptTemplate: string[]
}

export const DESIGN_COMMANDS: DesignCommandDefinition[] = [
  {
    id: 'polish',
    token: '/polish',
    label: 'Polish',
    description: 'Final quality pass: alignment, spacing, consistency, contrast, and edge details on the target surface.',
    aliases: ['/final-pass', '/fine-tune'],
    icon: 'auto_fix_high',
    scope: 'all',
    category: 'harden',
    promptTemplate: [
      'Run a final quality polish pass over the target surface.',
      'Check alignment and rhythm (grid lines, gutters, optical alignment), spacing consistency, border/radius consistency, contrast of text vs background, and small edge details (focus rings, empty states, hover states, truncation).',
      'Fix everything that looks unfinished, misaligned, or inconsistent. Do not add new features or change the design direction — polish only.',
    ],
  },
  {
    id: 'typeset',
    token: '/typeset',
    label: 'Typeset',
    description: 'Typography pass: hierarchy, sizes, line-height, letter-spacing, font stack, and measure.',
    aliases: ['/typography', '/type'],
    icon: 'text_fields',
    scope: 'type',
    category: 'refine',
    promptTemplate: [
      'Run a typography typeset pass over the target surface.',
      'Tighten the type hierarchy: one display/heading size per level, a clear body size, sensible line-height and letter-spacing, and a measure (line length) in the comfortable reading range.',
      'Use the client type stack from the Design Context; never introduce a generic default stack. Watch for tiny body text (<12px), tight line-height, wide letter-spacing, and flat hierarchy.',
    ],
  },
  {
    id: 'layout',
    token: '/layout',
    label: 'Layout',
    description: 'Spacing and rhythm pass: padding, margins, grid alignment, whitespace, and surface structure.',
    aliases: ['/spacing', '/rhythm'],
    icon: 'grid_view',
    scope: 'layout',
    category: 'refine',
    promptTemplate: [
      'Run a layout and rhythm pass over the target surface.',
      'Fix spacing inconsistencies: padding/margin scale, grid alignment, card stacking, section rhythm, and whitespace that gives the layout room to breathe.',
      'Use the client radius and elevation scales from the Design Context. Watch for cramped padding, long line lengths, nested cards, and side-tab borders.',
    ],
  },
  {
    id: 'colorize',
    token: '/colorize',
    label: 'Colorize',
    description: 'Strategic color pass: palette adherence, contrast, gradient usage, and accessible color pairs.',
    aliases: ['/color', '/palette'],
    icon: 'palette',
    scope: 'all',
    category: 'refine',
    promptTemplate: [
      'Run a strategic color pass over the target surface.',
      'Ground every color choice in the client palette from the Design Context; never fall back to a generic purple/blue SaaS gradient. Verify text/background contrast (4.5:1 body, 3:1 large) and remove glassmorphism or dark-glow slop unless the client brand actually uses it.',
      'Keep the overall color count low and purposeful; each accent color must carry a job.',
    ],
  },
  {
    id: 'bolder',
    token: '/bolder',
    label: 'Bolder',
    description: 'Amplify the surface: stronger hierarchy, higher contrast, more presence, bigger statement.',
    aliases: ['/amplify', '/louder'],
    icon: 'trending_up',
    scope: 'type',
    category: 'refine',
    promptTemplate: [
      'Make the target surface bolder and more confident.',
      'Amplify the hierarchy: larger display/heading scale, stronger weight contrast, higher text-to-background contrast, and more assertive spacing for the primary message.',
      'Keep it tasteful — amplify within the client design system and never tip into garish. Run the detector after and fix any contrast or hierarchy regressions.',
    ],
  },
  {
    id: 'quieter',
    token: '/quieter',
    label: 'Quieter',
    description: 'Tone the surface down: reduce noise, clutter, and visual competition; let content breathe.',
    aliases: ['/calm', '/tone-down'],
    icon: 'remove',
    scope: 'layout',
    category: 'refine',
    promptTemplate: [
      'Make the target surface quieter and calmer.',
      'Reduce visual noise: remove or mute decorative gradients, drop shadow piles, competing accent colors, and excessive borders. Increase whitespace, simplify card nesting, and let the primary content dominate.',
      'This is a de-emphasis pass, not a feature removal. Keep all functionality, just make it visually quieter.',
    ],
  },
  {
    id: 'distill',
    token: '/distill',
    label: 'Distill',
    description: 'Strip the surface to its essence: cut anything that does not serve the primary job.',
    aliases: ['/strip', '/simplify'],
    icon: 'filter_alt',
    scope: 'layout',
    category: 'simplify',
    promptTemplate: [
      'Distill the target surface to its essence.',
      'Identify the single primary job of the surface and remove or demote anything that does not serve it: redundant copy, decorative filler, extra CTAs, duplicate navigation, non-essential modules.',
      'Every surviving element must earn its place. Keep the function intact but reduce the surface to the fewest elements that still do the job.',
    ],
  },
  {
    id: 'clarify',
    token: '/clarify',
    label: 'Clarify',
    description: 'Copy and microcopy pass: clear headings, labels, CTAs, empty states, and error messages.',
    aliases: ['/copy', '/microcopy'],
    icon: 'record_voice_over',
    scope: 'type',
    category: 'simplify',
    promptTemplate: [
      'Run a clarify pass over the surface copy and microcopy.',
      'Make every heading, label, button, empty state, and error message say exactly what it means in the client voice from the Design Context. Kill jargon, ambiguity, and AI-slop filler; prefer concrete verbs and specific outcomes.',
      'Do not change the design or layout — this pass is about words, and only words.',
    ],
  },
  {
    id: 'harden',
    token: '/harden',
    label: 'Harden',
    description: 'Production-readiness pass: error states, overflow, missing states, i18n, and edge cases.',
    aliases: ['/production', '/robust'],
    icon: 'shield',
    scope: 'all',
    category: 'harden',
    promptTemplate: [
      'Harden the target surface for production.',
      'Check and fix failure and edge states: loading/empty/error states, long-content overflow, small-viewport behavior, missing image/alt handling, unlabeled controls, and broken interactive affordances.',
      'Also run the detector for quality basics and a11y (labels, alt, contrast, tiny text) and fix every error-level finding.',
    ],
  },
  {
    id: 'audit',
    token: '/audit',
    label: 'Audit',
    description: 'Technical design audit: run the full T1 detector and fix findings by severity.',
    aliases: ['/design-audit', '/check'],
    icon: 'fact_check',
    scope: 'all',
    category: 'evaluate',
    promptTemplate: [
      'Run a full design audit of the target surface using the T1 design detector.',
      'Run the detector (scope all), read the findings grouped P0-P3, and fix every error- and warning-level finding unless there is a real stated reason to waive it (record the waiver).',
      'Also review against the client Design Context (T3) and flag any drift from palette/type/radius. Report the before/after finding counts.',
    ],
  },
  {
    id: 'critique',
    token: '/critique',
    label: 'Critique',
    description: 'UX critique: hierarchy, interaction, affordance, and flow against the surface job.',
    aliases: ['/review', '/ux'],
    icon: 'rate_review',
    scope: 'all',
    category: 'evaluate',
    promptTemplate: [
      'Critique the target surface as a UX reviewer.',
      'Evaluate hierarchy (does the primary action and message dominate?), interaction (are controls obvious and forgiving?), affordance (can a new user tell what is clickable/editable?), and flow (is the path to the goal short and clear?).',
      'Name concrete issues with location + suggestion, then fix the highest-value ones. Ground the critique in the client Design Context and surface-mode (persuade/operate/read/experience).',
    ],
  },
]

export const DESIGN_COMMAND_IDS: readonly DesignCommandId[] = DESIGN_COMMANDS.map((command) => command.id)

export function isDesignCommandId(value: unknown): value is DesignCommandId {
  return typeof value === 'string' && (DESIGN_COMMAND_IDS as readonly string[]).includes(value)
}

export function getDesignCommandById(id: string | null | undefined): DesignCommandDefinition | null {
  if (!id) return null
  return DESIGN_COMMANDS.find((command) => command.id === id) ?? null
}

export function getDesignCommandByToken(token: string): DesignCommandDefinition | null {
  const normalized = token.trim().toLowerCase()
  if (!normalized.startsWith('/')) return null
  return DESIGN_COMMANDS.find(
    (command) => command.token === normalized || command.aliases.includes(normalized),
  ) ?? null
}

/**
 * Build the agent-facing guidance block for a design-command slash payload.
 * Mirrors the vocabulary + discipline from the impeccable-design-discipline
 * skill, with the T1 detector scope and the T3 design-context requirement.
 */
export function buildDesignCommandGuidance(input: {
  id: DesignCommandId | string
  token: string
  label: string
  args?: string
}): string[] {
  const command = getDesignCommandById(input.id)
  if (!command) return []
  const scopeLine = command.scope === 'all'
    ? 'detector scope: all (run every rule)'
    : `detector scope: ${command.scope} (--scope ${command.scope}; any-scope rules still run)`
  return [
    '[Design command]',
    `command: ${command.label} (${command.token})`,
    `discipline: ${command.description}`,
    scopeLine,
    'Design Context (T3): resolve the client Design Context record (research kind=design, latest version) and cite its palette, type stack, radius/elevation, voice, and surface mode in every decision. If no Design Context exists for this org, say so explicitly and flag that a /init design-context questionnaire or style scan is needed — do not silently invent one.',
    'Detector (T1) BEFORE: run the design detector on the target surface and record the baseline exit code + finding count.',
    'Detector (T1) AFTER: after applying the discipline, re-run the detector and fix every error/warning finding (or record a real waiver). Report before/after counts in your reply.',
    ...command.promptTemplate,
    input.args ? `target: ${input.args}` : 'target: (infer the surface from the conversation context or ask the user)',
    '---',
    '',
  ]
}

/**
 * Pure renderer for a T3 Design Context payload → compact prompt block.
 * Server callers load the record (research kind=design) and pass the payload
 * here; the client never imports this with server-only deps.
 */
export function renderDesignContextPayload(payload: unknown, fallback = ''): string {
  if (!payload || typeof payload !== 'object') return fallback
  const ctx = payload as Record<string, unknown>

  const lines: string[] = []
  const push = (label: string, value: unknown, max = 12): void => {
    if (Array.isArray(value)) {
      const items = value
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return String(entry)
          const e = entry as Record<string, unknown>
          return Object.values(e)
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => String(v).trim())
            .join(' · ')
        })
        .filter(Boolean)
        .slice(0, max)
      if (items.length) lines.push(`- ${label}: ${items.join('; ')}`)
      return
    }
    if (typeof value === 'string' && value.trim()) {
      lines.push(`- ${label}: ${value.trim().replace(/\s+/g, ' ').slice(0, 400)}`)
    }
  }

  push('audience', ctx.audience)
  push('positioning', ctx.positioning)
  push('brandVoice', ctx.brandVoice)
  push('antiReferences', ctx.antiReferences)
  push('palette', ctx.palette)
  push('typeStack', ctx.typeStack)
  push('componentRules', ctx.componentRules)
  push('radiusScale', ctx.radiusScale)
  push('elevationScale', ctx.elevationScale)
  push('surfaceModes', ctx.surfaceModes)
  if (typeof ctx.version === 'number') lines.push(`- version: ${ctx.version}`)

  if (lines.length === 0) return fallback
  return ['[Client Design Context (T3)]', ...lines, '---', ''].join('\n')
}

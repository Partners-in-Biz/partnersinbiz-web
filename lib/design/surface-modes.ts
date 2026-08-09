/**
 * Surface-mode awareness — canonical SurfaceMode enum + standards catalog.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * tag every web surface (landing, dashboard, docs, portfolio) with its mode —
 * Persuade / Operate / Read / Experience — so agents pick the right design
 * standard automatically. A landing page earns attention; a dashboard
 * disappears into the task.
 *
 * This module is the single source of truth for the enum, the mode standards,
 * and the prompt-block renderer used by task dispatch. `lib/research/design-context.ts`
 * aliases its surface-mode types to these values so the two stay in sync.
 */

export type SurfaceMode = 'persuade' | 'operate' | 'read' | 'experience'

export const SURFACE_MODES: readonly SurfaceMode[] = ['persuade', 'operate', 'read', 'experience'] as const

export function isSurfaceMode(value: unknown): value is SurfaceMode {
  return typeof value === 'string' && (SURFACE_MODES as readonly string[]).includes(value)
}

export interface SurfaceModeStandard {
  /** Human label, e.g. 'Persuade'. */
  label: string
  /** One-line mission: what the surface must accomplish. */
  mission: string
  /** Design priorities the agent should optimize for. */
  priorities: string[]
  /** Anti-patterns to avoid in this mode. */
  antiPatterns: string[]
}

export const SURFACE_MODE_STANDARDS: Record<SurfaceMode, SurfaceModeStandard> = {
  persuade: {
    label: 'Persuade',
    mission: 'A landing page earns attention: distinctive type and image-led hero, a clear value proposition, and one primary action.',
    priorities: [
      'Distinctive hero + headline that sells the outcome',
      'Image-led visual hierarchy',
      'One clear primary CTA above the fold',
      'Trust signals and social proof',
      'Scannable benefit sections',
    ],
    antiPatterns: [
      'Generic SaaS template hero (icon tiles, glassmorphism, purple gradients)',
      'CTA buried below the fold',
      'Muted, low-contrast everything',
    ],
  },
  operate: {
    label: 'Operate',
    mission: 'A dashboard disappears into the task: density, native expectations, fast scanning, minimal decoration.',
    priorities: [
      'Density and native expectations (tables, compact controls)',
      'Status and data visible at a glance',
      'Fast scanning, predictable layout',
      'Keyboard-friendly, minimal chrome',
      'Clear empty and error states',
    ],
    antiPatterns: [
      'Marketing hero or decorative gradients on a dashboard',
      'Oversized cards that waste screen space',
      'Hidden status or buried actions',
    ],
  },
  read: {
    label: 'Read',
    mission: 'Docs structure for comprehension: clear hierarchy, readable line lengths, scannable headings, focused reading experience.',
    priorities: [
      'Clear heading hierarchy and structure-for-comprehension',
      'Readable line lengths (45-90 characters)',
      'Table of contents / navigation',
      'Callouts for key facts and caveats',
      'Consistent code/term styling',
    ],
    antiPatterns: [
      'Dense walls of text without headings',
      'Full-width paragraphs',
      'Missing heading levels',
    ],
  },
  experience: {
    label: 'Experience',
    mission: 'A portfolio is artifact-first: the work leads, atmosphere supports, and chrome stays out of the way.',
    priorities: [
      'Artifact-first layout (large imagery, the work leads)',
      'Atmosphere / mood through color and type',
      'Restrained chrome around the content',
      'Motion used as accent, not decoration',
      'Clear case-study narrative',
    ],
    antiPatterns: [
      'Chrome competing with the work',
      'Uniform template card grids everywhere',
      'No atmosphere (flat white, no rhythm)',
    ],
  },
}

export function surfaceModeLabel(mode: SurfaceMode): string {
  return SURFACE_MODE_STANDARDS[mode].label
}

/**
 * Render the mode-standard prompt block injected into agent task prompts.
 * Returns '' for unknown/empty input so callers can skip the block safely.
 */
export function buildSurfaceModePromptBlock(mode: unknown): string {
  if (!isSurfaceMode(mode)) return ''
  const standard = SURFACE_MODE_STANDARDS[mode]
  const lines = [
    `## Surface mode: ${standard.label}`,
    `${standard.mission}`,
    `Priorities: ${standard.priorities.join('; ')}`,
    `Avoid: ${standard.antiPatterns.join('; ')}`,
  ]
  return lines.join('\n')
}

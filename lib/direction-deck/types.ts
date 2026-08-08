/**
 * Direction deck — types.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * for landing-page/site projects, offer 3-6 human-vetted 'worlds' (graphic
 * systems: palette/type/composition/controls/motion + one spark scene) as a
 * review deck in Messages; the agent derives a grounded shortlist from the
 * client brief, then a seeded script picks the index (assign, don't nominate).
 * Acceptance is recorded; future deals are weighted by wins.
 */

export type WorldStatus = 'draft' | 'vetted'

/** Local-business categories a world is suited for. */
export type WorldCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'salon'
  | 'barber'
  | 'spa'
  | 'wellness'
  | 'gym'
  | 'fitness'
  | 'real-estate'
  | 'legal'
  | 'accounting'
  | 'medical'
  | 'dental'
  | 'trades'
  | 'home-services'
  | 'landscaping'
  | 'cleaning'
  | 'retail'
  | 'boutique'
  | 'auto'
  | 'education'
  | 'events'
  | 'photography'
  | 'construction'
  | 'pet'
  | 'bakery'
  | 'hotel'
  | 'creative'
  | 'general'

export interface WorldPaletteColor {
  /** Role, e.g. `primary`, `background`, `text`, `accent`. */
  name: string
  /** Value, e.g. `#0F172A`. */
  value: string
}

export interface WorldTypeRole {
  /** Role: display / heading / body / mono / label. */
  role: 'display' | 'heading' | 'body' | 'mono' | 'label'
  /** Font family stack. */
  family: string
  /** Optional size/scale note. */
  scale?: string
}

/** The five system rules of a world. */
export interface WorldSystem {
  palette: WorldPaletteColor[]
  type: WorldTypeRole[]
  composition: string[]
  controls: string[]
  motion: string[]
}

/** A graphic-system 'world': 5 system rules + one spark scene. */
export interface DirectionWorld {
  /** Stable slug id, e.g. `swiss-modern`. */
  id: string
  /** Human name, e.g. 'Swiss Modern'. */
  name: string
  /** Era/school reference, e.g. 'International Typographic Style'. */
  school: string
  /** One-line summary of the system. */
  summary: string
  /** Local-business categories this world fits. */
  categories: WorldCategory[]
  /** Human approval gate: only `vetted` worlds roll by default. */
  status: WorldStatus
  /** Flagship worlds get double odds on the roll. */
  flagship: boolean
  system: WorldSystem
  /** One hero/first-viewport scene description used as the build target. */
  sparkScene: string
}

export interface RollOptions {
  /** Reproducibility key. Same seed + pool revision + pool => same pick. */
  seed: string
  /** Pool revision; bumping it changes rolls even with the same seed. */
  poolRevision?: string
  /** Optional shortlist of world ids derived from the client brief. */
  shortlist?: string[]
  /** Worlds already dealt (excluded from this roll). */
  exclude?: string[]
  /** Include draft worlds (agent authoring/preview); default false. */
  includeDrafts?: boolean
  /** Wins map (accepted counts) used to weight the roll. */
  wins?: Record<string, number>
}

export interface RollResult {
  picked: DirectionWorld
  /** Ordered pool that was actually rolled over (after filters/exclusion). */
  pool: DirectionWorld[]
  /** Per-world weight used in the pick. */
  weights: Record<string, number>
  poolRevision: string
  seedHash: string
}

export interface ReviewDeckOptions {
  seed: string
  poolRevision?: string
  /** Deck size; clamped to [3, 6] and to the pool size. */
  count?: number
  category?: WorldCategory
  exclude?: string[]
  includeDrafts?: boolean
  wins?: Record<string, number>
}

export type AcceptanceOutcome = 'accepted' | 'rejected'

export interface AcceptanceRecord {
  worldId: string
  outcome: AcceptanceOutcome
  at: string
  note?: string
}

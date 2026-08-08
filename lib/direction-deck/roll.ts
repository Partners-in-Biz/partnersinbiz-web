/**
 * Direction deck — seeded roll semantics.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * the model derives a grounded shortlist, then a SCRIPT rolls which index
 * gets built — dice ASSIGN, never nominate. Weighted, chained, reproducible:
 *   - same seed + pool revision + pool => bit-for-bit same pick
 *   - re-rolls exclude already-dealt worlds
 *   - flagship worlds get double odds
 *   - accepted worlds (wins) get extra weight on future deals
 */

import { getWorldById, POOL_REVISION, vettedWorlds, worldsForCategory } from './catalog'
import type { DirectionWorld, ReviewDeckOptions, RollOptions, RollResult, WorldCategory } from './types'

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32 — public-domain algorithm). No Math.random.
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit string hash — deterministic across platforms. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mulberry32 PRNG — deterministic [0,1) stream from a 32-bit seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weighted pick from a list of ids with weights; returns index into ids. */
export function weightedPick(ids: string[], weights: Record<string, number>, rng: () => number): string {
  const total = ids.reduce((sum, id) => sum + Math.max(0, weights[id] ?? 0), 0)
  if (total <= 0) throw new Error('weightedPick: pool has zero total weight')
  let roll = rng() * total
  for (const id of ids) {
    roll -= Math.max(0, weights[id] ?? 0)
    if (roll < 0) return id
  }
  // Floating-point safety: return the last id if we exhausted the range.
  return ids[ids.length - 1]
}

export interface WeightedWorld {
  world: DirectionWorld
  weight: number
}

/**
 * Build the weighted pool for a roll.
 * - Filters to vetted worlds by default (human approval gate).
 * - Applies shortlist if given; otherwise all vetted worlds (optionally a category).
 * - Excludes already-dealt worlds.
 * - Weight = 1 (flagship => 2) * (1 + wins).
 */
export function buildWeightedPool(options: RollOptions): { pool: DirectionWorld[]; weights: Record<string, number> } {
  const all = options.includeDrafts ? [...vettedWorlds(), ...worldsForCategory(undefined).filter((w) => w.status === 'draft')] : vettedWorlds()
  const byId = new Map(all.map((world) => [world.id, world]))
  const candidates = options.shortlist && options.shortlist.length > 0
    ? options.shortlist.map((id) => byId.get(id)).filter((world): world is DirectionWorld => Boolean(world))
    : all

  const exclude = new Set(options.exclude ?? [])
  const pool = candidates.filter((world) => !exclude.has(world.id))

  const weights: Record<string, number> = {}
  for (const world of pool) {
    const base = world.flagship ? 2 : 1
    const wins = options.wins?.[world.id] ?? 0
    weights[world.id] = base * (1 + wins)
  }
  return { pool, weights }
}

/** Roll ONE world from the weighted pool (assign, don't nominate). */
export function rollWorld(options: RollOptions): RollResult {
  const poolRevision = options.poolRevision ?? POOL_REVISION
  const { pool, weights } = buildWeightedPool(options)
  if (pool.length === 0) throw new Error('rollWorld: no worlds in pool after filters/exclusion')

  // Deterministic seed material: seed + pool revision + sorted shortlist + sorted excludes.
  const shortlistKey = [...(options.shortlist ?? [])].sort().join(',')
  const excludeKey = [...(options.exclude ?? [])].sort().join(',')
  const seedMaterial = `${poolRevision}|${options.seed}|${shortlistKey}|${excludeKey}`
  const seedHash = hashString(seedMaterial)
  const rng = createRng(seedHash)

  const ids = pool.map((world) => world.id)
  const pickedId = weightedPick(ids, weights, rng)
  const picked = getWorldById(pickedId)
  if (!picked) throw new Error(`rollWorld: picked unknown world ${pickedId}`)

  return { picked, pool, weights, poolRevision, seedHash: seedHash.toString(16) }
}

/**
 * Build a review deck of 3-6 worlds (clamped to pool size) for a Messages
 * review: a deterministic, weighted, no-replacement draw.
 */
export function buildReviewDeck(options: ReviewDeckOptions): DirectionWorld[] {
  const count = Math.max(3, Math.min(6, options.count ?? 4))
  const poolRevision = options.poolRevision ?? POOL_REVISION
  const poolBase = options.category
    ? worldsForCategory(options.category as WorldCategory)
    : (options.includeDrafts ? [...vettedWorlds(), ...worldsForCategory(undefined).filter((w) => w.status === 'draft')] : vettedWorlds())
  const exclude = new Set(options.exclude ?? [])
  const pool = poolBase.filter((world) => !exclude.has(world.id))
  if (pool.length === 0) throw new Error('buildReviewDeck: no worlds in pool')

  // Weighted draw without replacement: roll each pick from the remaining pool,
  // each with the same deterministic stream keyed by (revision, seed, pool, pick#).
  const deck: DirectionWorld[] = []
  const remaining = pool.map((world) => world.id)
  for (let i = 0; i < Math.min(count, remaining.length); i++) {
    const rng = createRng(hashString(`${poolRevision}|deck|${options.seed}|${remaining.sort().join(',')}|${i}`))
    const weights: Record<string, number> = {}
    for (const id of remaining) {
      const world = getWorldById(id)
      const base = world?.flagship ? 2 : 1
      const wins = options.wins?.[id] ?? 0
      weights[id] = base * (1 + wins)
    }
    const pickedId = weightedPick(remaining, weights, rng)
    const picked = getWorldById(pickedId)
    if (!picked) throw new Error(`buildReviewDeck: picked unknown world ${pickedId}`)
    deck.push(picked)
    remaining.splice(remaining.indexOf(pickedId), 1)
  }
  return deck
}

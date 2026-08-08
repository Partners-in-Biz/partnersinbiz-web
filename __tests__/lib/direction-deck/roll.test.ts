import { POOL_REVISION } from '@/lib/direction-deck/catalog'
import { rollWorld, buildReviewDeck, buildWeightedPool, hashString, createRng, weightedPick } from '@/lib/direction-deck/roll'
import { vettedWorlds } from '@/lib/direction-deck/catalog'

describe('direction-deck seeded roll semantics', () => {
  it('same seed + revision + shortlist reproduces bit-for-bit', () => {
    const a = rollWorld({ seed: 'client-x', shortlist: ['swiss-modern', 'coastal-calm', 'artisan-letterpress'] })
    const b = rollWorld({ seed: 'client-x', shortlist: ['swiss-modern', 'coastal-calm', 'artisan-letterpress'] })
    expect(a.picked.id).toBe(b.picked.id)
    expect(a.seedHash).toBe(b.seedHash)
    expect(a.pool.map((w) => w.id)).toEqual(b.pool.map((w) => w.id))
    expect(a.weights).toEqual(b.weights)
  })

  it('different seed can pick a different world', () => {
    const ids = ['swiss-modern', 'coastal-calm', 'artisan-letterpress', 'editorial-broadsheet', 'botanical-natural', 'brutalist-utility']
    const picks = new Set(ids.map((seed) => rollWorld({ seed, shortlist: ids }).picked.id))
    // With 6 seeds over 6 worlds, we expect more than 1 distinct pick (very unlikely to collide on all).
    expect(picks.size).toBeGreaterThan(1)
  })

  it('bumping pool revision changes the roll for the same seed', () => {
    const ids = ['swiss-modern', 'coastal-calm', 'artisan-letterpress', 'editorial-broadsheet', 'botanical-natural', 'brutalist-utility', 'vintage-americana', 'medical-calm']
    const v1 = rollWorld({ seed: 'fixed', shortlist: ids, poolRevision: 'worlds-v1' })
    const v2 = rollWorld({ seed: 'fixed', shortlist: ids, poolRevision: 'worlds-v2' })
    expect(v1.seedHash).not.toBe(v2.seedHash)
    // Almost surely a different pick with 8 worlds; assert the hash differs at minimum.
    expect(v1.picked.id).not.toBe(v2.picked.id)
  })

  it('excludes already-dealt worlds (chained re-roll)', () => {
    const ids = ['swiss-modern', 'coastal-calm', 'artisan-letterpress']
    const first = rollWorld({ seed: 'chain', shortlist: ids })
    const second = rollWorld({ seed: 'chain', shortlist: ids, exclude: [first.picked.id] })
    expect(second.picked.id).not.toBe(first.picked.id)
    expect(second.pool.map((w) => w.id)).not.toContain(first.picked.id)
  })

  it('honours the human approval gate: drafts do not roll by default', () => {
    const result = rollWorld({ seed: 'gate', shortlist: ['tech-dark-ops', 'swiss-modern'] })
    expect(result.picked.id).toBe('swiss-modern')
    expect(result.pool.map((w) => w.id)).toEqual(['swiss-modern'])
  })

  it('flagship worlds get double base weight', () => {
    const { weights } = buildWeightedPool({ seed: 'w', shortlist: ['swiss-modern', 'coastal-calm'] })
    // swiss-modern is flagship => 2, coastal-calm is not => 1
    expect(weights['swiss-modern']).toBe(2)
    expect(weights['coastal-calm']).toBe(1)
  })

  it('wins add weight for future deals', () => {
    const { weights } = buildWeightedPool({
      seed: 'w',
      shortlist: ['swiss-modern', 'coastal-calm'],
      wins: { 'coastal-calm': 3 },
    })
    // coastal-calm: 1 * (1+3) = 4 > swiss-modern flagship 2 * (1+0) = 2
    expect(weights['coastal-calm']).toBe(4)
    expect(weights['swiss-modern']).toBe(2)
  })

  it('weightedPick returns an id inside the pool', () => {
    const rng = createRng(hashString('test'))
    const ids = ['a', 'b', 'c']
    const weights = { a: 1, b: 2, c: 3 }
    const picked = weightedPick(ids, weights, rng)
    expect(ids).toContain(picked)
  })

  it('buildReviewDeck returns 3-6 unique vetted worlds', () => {
    const deck = buildReviewDeck({ seed: 'review', count: 4 })
    expect(deck.length).toBe(4)
    expect(new Set(deck.map((w) => w.id)).size).toBe(4)
    expect(deck.every((w) => w.status === 'vetted')).toBe(true)
  })

  it('buildReviewDeck clamps count to [3,6]', () => {
    expect(buildReviewDeck({ seed: 'r1', count: 1 }).length).toBe(3)
    expect(buildReviewDeck({ seed: 'r2', count: 99 }).length).toBe(6)
    expect(buildReviewDeck({ seed: 'r3', count: 4 }).length).toBe(4)
  })

  it('buildReviewDeck is deterministic for the same seed', () => {
    const a = buildReviewDeck({ seed: 'same', count: 4 })
    const b = buildReviewDeck({ seed: 'same', count: 4 })
    expect(a.map((w) => w.id)).toEqual(b.map((w) => w.id))
  })

  it('full catalog roll works without a shortlist', () => {
    const result = rollWorld({ seed: 'any-client' })
    expect(result.pool.length).toBeGreaterThanOrEqual(12)
    expect(result.picked).toBeDefined()
    expect(vettedWorlds().some((w) => w.id === result.picked.id)).toBe(true)
  })

  it('pool revision is included in seed material', () => {
    expect(hashString(`${POOL_REVISION}|s`)).not.toBe(hashString(`other|s`))
  })
})

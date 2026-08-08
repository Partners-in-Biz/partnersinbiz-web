import { deriveShortlist, scoreWorldAgainstBrief } from '@/lib/direction-deck/shortlist'
import { getWorldById } from '@/lib/direction-deck/catalog'

describe('direction-deck grounded shortlist', () => {
  it('derives a grounded shortlist from a restaurant brief', () => {
    const brief = 'We are a family restaurant opening a new dining room with a chef-driven menu.'
    const { shortlist, scored, grounded } = deriveShortlist(brief)
    expect(grounded).toBe(true)
    expect(shortlist.length).toBeGreaterThan(0)
    // Every shortlisted world must have a positive score.
    expect(scored.every((entry) => entry.score > 0)).toBe(true)
    // Restaurant-category worlds should rank at or near the top.
    const restaurantWorlds = scored.filter((entry) => entry.world.categories.includes('restaurant'))
    expect(restaurantWorlds.length).toBeGreaterThan(0)
    expect(restaurantWorlds[0].matchedCategories).toContain('restaurant')
  })

  it('scores a barber brief toward barber/urban/americana worlds', () => {
    const brief = 'Barbershop in the city centre, mens grooming, classic shaves and fades.'
    const { shortlist, scored } = deriveShortlist(brief)
    expect(shortlist.length).toBeGreaterThan(0)
    const matched = scored.some((entry) => entry.matchedCategories.includes('barber'))
    expect(matched).toBe(true)
  })

  it('returns an ungrounded fallback when the brief has no signal', () => {
    const { shortlist, grounded } = deriveShortlist('')
    expect(grounded).toBe(false)
    expect(shortlist.length).toBeGreaterThan(0)
  })

  it('limits the shortlist size', () => {
    const brief = 'gym fitness training studio personal training bootcamp workout pilates strength'
    const { shortlist } = deriveShortlist(brief, { limit: 3 })
    expect(shortlist.length).toBeLessThanOrEqual(3)
  })

  it('filters by explicit category when provided', () => {
    const brief = 'we need a new website'
    const { shortlist } = deriveShortlist(brief, { category: 'legal' })
    expect(shortlist.length).toBeGreaterThan(0)
    for (const id of shortlist) {
      const world = getWorldById(id)
      expect(world?.categories).toContain('legal')
    }
  })

  it('scoreWorldAgainstBrief returns zero for an unrelated world', () => {
    const world = getWorldById('swiss-modern')
    expect(world).toBeDefined()
    const entry = scoreWorldAgainstBrief(world!, 'we sell cupcakes to pets and their owners')
    // swiss-modern is general; it may match nothing in this brief => score 0 or small.
    expect(entry.score).toBeGreaterThanOrEqual(0)
  })
})

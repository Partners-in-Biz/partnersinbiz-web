import { WORLD_CATALOG, WORLD_CATEGORIES, POOL_REVISION, vettedWorlds, getWorldById, DRAFT_WORLD_IDS } from '@/lib/direction-deck/catalog'

describe('direction-deck catalog', () => {
  it('contains 20-50 worlds (P2 spec)', () => {
    expect(WORLD_CATALOG.length).toBeGreaterThanOrEqual(20)
    expect(WORLD_CATALOG.length).toBeLessThanOrEqual(50)
  })

  it('has unique ids and a vetted subset for the human approval gate', () => {
    const ids = WORLD_CATALOG.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    const vetted = vettedWorlds()
    expect(vetted.length).toBeGreaterThanOrEqual(12)
    expect(vetted.every((w) => w.status === 'vetted')).toBe(true)
    // DRAFT_WORLD_IDS must all exist and be drafts.
    for (const id of DRAFT_WORLD_IDS) {
      const world = getWorldById(id)
      expect(world).toBeDefined()
      expect(world?.status).toBe('draft')
    }
  })

  it('every world has the five system rules + a spark scene', () => {
    for (const world of WORLD_CATALOG) {
      expect(world.system.palette.length).toBeGreaterThanOrEqual(2)
      expect(world.system.type.length).toBeGreaterThanOrEqual(3)
      expect(world.system.composition.length).toBeGreaterThanOrEqual(2)
      expect(world.system.controls.length).toBeGreaterThanOrEqual(2)
      expect(world.system.motion.length).toBeGreaterThanOrEqual(1)
      expect(world.sparkScene.trim().length).toBeGreaterThan(20)
      expect(world.school.trim().length).toBeGreaterThan(3)
    }
  })

  it('every category reference is a valid category', () => {
    const valid = new Set<string>(WORLD_CATEGORIES)
    for (const world of WORLD_CATALOG) {
      for (const category of world.categories) {
        expect(valid.has(category)).toBe(true)
      }
    }
  })

  it('flagship worlds exist (double-odds pool) but are not the whole catalog', () => {
    const flagship = WORLD_CATALOG.filter((w) => w.flagship)
    expect(flagship.length).toBeGreaterThanOrEqual(4)
    expect(flagship.length).toBeLessThan(WORLD_CATALOG.length)
  })

  it('exposes a stable pool revision', () => {
    expect(POOL_REVISION).toMatch(/^worlds-v\d+$/)
  })
})

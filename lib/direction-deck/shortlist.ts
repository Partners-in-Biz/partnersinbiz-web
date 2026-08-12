/**
 * Direction deck — grounded shortlist derivation.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * the agent derives a GROUNDED shortlist from the client brief, then a seeded
 * script picks the index. This module scores every world against the brief
 * text (category keyword + school/summary signal) so the shortlist is
 * evidence-based, not vibes.
 *
 * The final pick is still ASSIGNED by the seeded roll — the shortlist only
 * narrows the pool.
 */

import { WORLD_CATALOG } from './catalog'
import type { DirectionWorld, WorldCategory } from './types'

/** Category keywords — expanded tokens used to match brief text. */
const CATEGORY_KEYWORDS: Record<WorldCategory, string[]> = {
  restaurant: ['restaurant', 'dining', 'eatery', 'kitchen', 'menu', 'chef', 'fine dining'],
  cafe: ['cafe', 'coffee', 'espresso', 'bakery cafe', 'brunch', 'café'],
  bar: ['bar', 'cocktail', 'pub', 'tavern', 'nightlife', 'drinks', 'lounge'],
  salon: ['salon', 'hair', 'stylist', 'beauty', 'manicure', 'colorist'],
  barber: ['barber', 'barbershop', 'men\'s grooming', 'shave', 'fade'],
  spa: ['spa', 'massage', 'facial', 'treatment', 'sauna', 'day spa'],
  wellness: ['wellness', 'yoga', 'meditation', 'holistic', 'self-care', 'recovery'],
  gym: ['gym', 'crossfit', 'weightlifting', 'strength', 'training studio'],
  fitness: ['fitness', 'personal training', 'bootcamp', 'workout', 'pilates'],
  'real-estate': ['real estate', 'property', 'homes', 'estate agent', 'listing', 'realtor', 'broker'],
  legal: ['law', 'legal', 'attorney', 'solicitor', 'lawyer', 'firm', 'litigation'],
  accounting: ['accounting', 'accountant', 'tax', 'bookkeeping', 'bookkeeper', 'audit', 'payroll'],
  medical: ['medical', 'clinic', 'doctor', 'physician', 'healthcare', 'general practice'],
  dental: ['dental', 'dentist', 'orthodontist', 'teeth', 'smile'],
  trades: ['plumber', 'plumbing', 'electrician', 'hvac', 'roofing', 'handyman', 'welder'],
  'home-services': ['home services', 'contractor', 'renovation', 'remodel', 'repair', 'maintenance'],
  landscaping: ['landscaping', 'garden', 'lawn', 'nursery', 'landscape design', 'tree'],
  cleaning: ['cleaning', 'cleaning service', 'janitorial', 'housekeeping', 'maid'],
  retail: ['retail', 'store', 'shop', 'boutique store', 'market'],
  boutique: ['boutique', 'fashion', 'clothing', 'apparel', 'curated', 'designer'],
  auto: ['auto', 'car', 'mechanic', 'automotive', 'detailing', 'repair shop', 'dealership'],
  education: ['education', 'school', 'tutoring', 'learning', 'academy', 'training center', 'childcare'],
  events: ['events', 'event planning', 'catering', 'venue', 'celebrations', 'wedding'],
  photography: ['photography', 'photographer', 'studio', 'portrait', 'photo'],
  construction: ['construction', 'builder', 'building', 'remodeling', 'general contractor'],
  pet: ['pet', 'dog', 'cat', 'grooming', 'veterinary', 'vet', 'animal'],
  bakery: ['bakery', 'bread', 'pastry', 'cakes', 'dessert', 'artisan bakery'],
  hotel: ['hotel', 'lodging', 'inn', 'bed and breakfast', 'accommodation', 'resort'],
  creative: ['creative', 'agency', 'design studio', 'branding', 'marketing', 'consulting', 'web design'],
  general: [],
}

export interface ShortlistScored {
  world: DirectionWorld
  score: number
  matchedCategories: WorldCategory[]
  matchedKeywords: string[]
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Score a world against a brief. Returns a positive score when there is
 * evidence (category keyword match, school/summary keyword overlap) and 0
 * when the brief gives no signal for that world.
 */
export function scoreWorldAgainstBrief(world: DirectionWorld, brief: string): ShortlistScored {
  const text = brief.toLowerCase()
  const matchedCategories: WorldCategory[] = []
  const matchedKeywords: string[] = []

  for (const category of world.categories) {
    const keywords = CATEGORY_KEYWORDS[category] ?? []
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        matchedKeywords.push(keyword)
        if (!matchedCategories.includes(category)) matchedCategories.push(category)
      }
    }
  }

  // School/summary signal: any meaningful noun in the world's summary that
  // also appears in the brief counts as weak grounding.
  const summaryTokens = new Set(tokenize(`${world.school} ${world.summary}`))
  const briefTokens = tokenize(brief)
  const overlap = [...summaryTokens].filter((token) => token.length > 3 && briefTokens.includes(token))

  const score = matchedKeywords.length * 2 + overlap.length
  return { world, score, matchedCategories, matchedKeywords: [...matchedKeywords, ...overlap] }
}

/**
 * Derive a grounded shortlist from a client brief.
 * - Worlds with a positive score rank first (evidence).
 * - When the brief is empty or no worlds match, falls back to a deterministic
 *   general-interest shortlist (vetted, non-draft, non-flagship first) so the
 *   roll still has a pool — but `grounded` is false so callers can warn.
 */
export function deriveShortlist(
  brief: string,
  options: { limit?: number; category?: WorldCategory } = {},
): { shortlist: string[]; scored: ShortlistScored[]; grounded: boolean } {
  const limit = options.limit ?? 8
  const pool = options.category
    ? WORLD_CATALOG.filter((world) => world.categories.includes(options.category as WorldCategory))
    : [...WORLD_CATALOG]

  const scored = pool
    .map((world) => scoreWorldAgainstBrief(world, brief))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.world.id.localeCompare(b.world.id))
    .slice(0, limit)

  if (scored.length > 0) {
    return { shortlist: scored.map((entry) => entry.world.id), scored, grounded: true }
  }

  // Fallback: vetted, category-respecting (when provided), deterministic order.
  const fallbackPool = options.category
    ? WORLD_CATALOG.filter((world) => world.status === 'vetted' && world.categories.includes(options.category as WorldCategory))
    : WORLD_CATALOG.filter((world) => world.status === 'vetted')
  const fallback = [...fallbackPool]
    .sort((a, b) => Number(a.flagship) - Number(b.flagship) || a.id.localeCompare(b.id))
    .slice(0, limit)
  if (fallback.length === 0 && options.category) {
    // Category has no vetted worlds yet; fall back to the general pool so the
    // roll still has a pool, but keep `grounded` false to signal the gap.
    const general = WORLD_CATALOG.filter((world) => world.status === 'vetted')
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
    return {
      shortlist: general.map((world) => world.id),
      scored: general.map((world) => ({ world, score: 0, matchedCategories: [], matchedKeywords: [] })),
      grounded: false,
    }
  }
  return {
    shortlist: fallback.map((world) => world.id),
    scored: fallback.map((world) => ({ world, score: 0, matchedCategories: [], matchedKeywords: [] })),
    grounded: false,
  }
}

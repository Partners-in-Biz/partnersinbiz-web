#!/usr/bin/env tsx
/**
 * Direction Deck CLI — seeded creative-direction rolls for landing/site work.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * dice ASSIGN, never nominate. The agent derives a grounded shortlist from
 * the client brief, then this script picks which world gets built.
 *
 * Commands:
 *   npx tsx scripts/direction-deck.ts list [--category <cat>] [--json]
 *   npx tsx scripts/direction-deck.ts deck --seed <seed> [--count 4] [--category <cat>] [--json]
 *   npx tsx scripts/direction-deck.ts roll --seed <seed> [--brief "<client brief>"] [--shortlist a,b,c] [--exclude x,y] [--json]
 *   npx tsx scripts/direction-deck.ts accept <worldId> [--note "..."]
 *   npx tsx scripts/direction-deck.ts reject <worldId> [--note "..."]
 *   npx tsx scripts/direction-deck.ts wins [--json]
 *
 * Semantics:
 *   - Same seed + POOL_REVISION + shortlist + excludes => bit-for-bit same pick.
 *   - Bumping POOL_REVISION changes rolls even for the same seed.
 *   - Re-rolls exclude already-dealt worlds (pass --exclude).
 *   - Flagship worlds get double odds; accepted worlds get extra weight.
 *   - Only vetted worlds roll by default (human approval gate).
 */

import { buildReviewDeck, deriveShortlist, getWorldById, POOL_REVISION, rollWorld, vettedWorlds, WORLD_CATEGORIES, worldsForCategory } from '../lib/direction-deck'
import { loadAcceptanceStore, recordAcceptance } from '../lib/direction-deck/acceptance'
import type { DirectionWorld } from '../lib/direction-deck/types'

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const name = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next
        i++
      } else {
        flags[name] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function assertSeed(flags: Record<string, string | boolean>): string {
  const seed = typeof flags.seed === 'string' && flags.seed.trim() ? flags.seed.trim() : ''
  if (!seed) throw new Error('--seed is required (reproducible rolls need a seed)')
  return seed
}

function worldToJson(world: DirectionWorld): Record<string, unknown> {
  return {
    id: world.id,
    name: world.name,
    school: world.school,
    summary: world.summary,
    categories: world.categories,
    status: world.status,
    flagship: world.flagship,
    palette: world.system.palette,
    type: world.system.type,
    composition: world.system.composition,
    controls: world.system.controls,
    motion: world.system.motion,
    sparkScene: world.sparkScene,
  }
}

function printWorld(world: DirectionWorld): void {
  console.log(`# ${world.name} (${world.id})${world.flagship ? ' ★ flagship' : ''} [${world.status}]`)
  console.log(`School: ${world.school}`)
  console.log(`Summary: ${world.summary}`)
  console.log('Palette: ' + world.system.palette.map((c) => `${c.name}=${c.value}`).join(' | '))
  console.log('Type: ' + world.system.type.map((t) => `${t.role}=${t.family}${t.scale ? ` (${t.scale})` : ''}`).join(' | '))
  console.log('Composition: ' + world.system.composition.join('; '))
  console.log('Controls: ' + world.system.controls.join('; '))
  console.log('Motion: ' + world.system.motion.join('; '))
  console.log(`Spark scene: ${world.sparkScene}`)
  console.log('')
}

function cmdList(flags: Record<string, string | boolean>, json: boolean): void {
  const category = typeof flags.category === 'string' && flags.category.trim() ? flags.category : undefined
  const worlds = category ? worldsForCategory(category as never) : [...vettedWorlds()]
  if (json) {
    console.log(JSON.stringify({ poolRevision: POOL_REVISION, worlds: worlds.map(worldToJson) }, null, 2))
    return
  }
  console.log(`Pool revision: ${POOL_REVISION} | ${worlds.length} worlds (${vettedWorlds().length} vetted)`)
  console.log('')
  for (const world of worlds) printWorld(world)
}

function cmdDeck(flags: Record<string, string | boolean>, json: boolean): void {
  const seed = assertSeed(flags)
  const count = typeof flags.count === 'string' ? Math.max(3, Math.min(6, Number(flags.count) || 4)) : 4
  const category = typeof flags.category === 'string' && flags.category.trim() ? flags.category : undefined
  const wins = loadAcceptanceStore().wins
  const deck = buildReviewDeck({ seed, count, category: category as never, wins })
  if (json) {
    console.log(JSON.stringify({ poolRevision: POOL_REVISION, seed, deck: deck.map(worldToJson) }, null, 2))
    return
  }
  console.log(`Review deck (seed=${seed}, revision=${POOL_REVISION}, count=${deck.length})`)
  console.log('')
  for (const world of deck) printWorld(world)
}

function cmdRoll(flags: Record<string, string | boolean>, json: boolean): void {
  const seed = assertSeed(flags)
  const brief = typeof flags.brief === 'string' && flags.brief.trim() ? flags.brief.trim() : undefined
  const shortlistArg = typeof flags.shortlist === 'string' && flags.shortlist.trim() ? flags.shortlist.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const exclude = typeof flags.exclude === 'string' && flags.exclude.trim() ? flags.exclude.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const wins = loadAcceptanceStore().wins

  let shortlist = shortlistArg
  let grounded = false
  if (!shortlist && brief) {
    const derived = deriveShortlist(brief)
    shortlist = derived.shortlist
    grounded = derived.grounded
  }

  const result = rollWorld({ seed, shortlist, exclude, wins })
  if (json) {
    console.log(JSON.stringify({
      poolRevision: result.poolRevision,
      seed,
      seedHash: result.seedHash,
      grounded,
      shortlist,
      pool: result.pool.map((w) => w.id),
      weights: result.weights,
      picked: worldToJson(result.picked),
    }, null, 2))
    return
  }
  console.log(`Roll (seed=${seed}, revision=${result.poolRevision}, hash=${result.seedHash})`)
  if (brief) console.log(`Brief-derived shortlist (grounded=${grounded}): ${shortlist?.join(', ') ?? '(fallback)'}`)
  console.log(`Pool (${result.pool.length}): ${result.pool.map((w) => w.id).join(', ')}`)
  console.log(`Weights: ${Object.entries(result.weights).map(([id, w]) => `${id}=${w}`).join(', ')}`)
  console.log('')
  console.log('>>> ASSIGNED WORLD <<<')
  printWorld(result.picked)
}

function cmdAccept(flags: Record<string, string | boolean>, worldId: string): void {
  const world = getWorldById(worldId)
  if (!world) throw new Error(`Unknown world: ${worldId}`)
  const note = typeof flags.note === 'string' ? flags.note : undefined
  const store = recordAcceptance(worldId, 'accepted', { note })
  console.log(`Recorded acceptance for ${world.name} (${worldId}). Wins: ${store.wins[worldId] ?? 1}`)
}

function cmdReject(flags: Record<string, string | boolean>, worldId: string): void {
  const world = getWorldById(worldId)
  if (!world) throw new Error(`Unknown world: ${worldId}`)
  const note = typeof flags.note === 'string' ? flags.note : undefined
  const store = recordAcceptance(worldId, 'rejected', { note })
  console.log(`Recorded rejection for ${world.name} (${worldId}). Wins: ${store.wins[worldId] ?? 0}`)
}

function cmdWins(json: boolean): void {
  const store = loadAcceptanceStore()
  if (json) {
    console.log(JSON.stringify({ records: store.records, wins: store.wins }, null, 2))
    return
  }
  console.log(`Acceptance ledger: ${store.records.length} records, ${Object.keys(store.wins).length} worlds with wins`)
  console.log('')
  for (const record of store.records) {
    const world = getWorldById(record.worldId)
    console.log(`${record.at} ${record.outcome.toUpperCase().padEnd(8)} ${world?.name ?? record.worldId}${record.note ? ` — ${record.note}` : ''}`)
  }
}

function main(): void {
  const { positional, flags } = parseFlags(process.argv.slice(2))
  const json = flags.json === true
  const command = positional[0] ?? 'help'

  switch (command) {
    case 'list':
      cmdList(flags, json)
      break
    case 'deck':
      cmdDeck(flags, json)
      break
    case 'roll':
      cmdRoll(flags, json)
      break
    case 'accept':
      if (!positional[1]) throw new Error('accept requires a worldId')
      cmdAccept(flags, positional[1])
      break
    case 'reject':
      if (!positional[1]) throw new Error('reject requires a worldId')
      cmdReject(flags, positional[1])
      break
    case 'wins':
      cmdWins(json)
      break
    case 'help':
    default:
      console.log(`Direction Deck CLI (pool revision ${POOL_REVISION})
Usage:
  direction-deck.ts list [--category <cat>] [--json]
  direction-deck.ts deck --seed <seed> [--count 4] [--category <cat>] [--json]
  direction-deck.ts roll --seed <seed> [--brief "..."] [--shortlist a,b,c] [--exclude x,y] [--json]
  direction-deck.ts accept <worldId> [--note "..."]
  direction-deck.ts reject <worldId> [--note "..."]
  direction-deck.ts wins [--json]

Categories: ${WORLD_CATEGORIES.join(', ')}`)
  }
}

try {
  main()
} catch (err) {
  console.error(`ERROR: ${(err as Error).message}`)
  process.exit(1)
}

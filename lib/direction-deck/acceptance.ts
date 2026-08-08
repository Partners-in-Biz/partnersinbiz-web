/**
 * Direction deck — acceptance recording and win weighting.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * "choice stream feeds future ratings" — record which world the client
 * accepted, and weight future deals by wins. Records are appended to a JSON
 * ledger file; the wins map derived from it feeds the roll weights.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AcceptanceOutcome, AcceptanceRecord } from './types'

export const DEFAULT_ACCEPTANCE_FILE = path.join(process.cwd(), '.direction-deck', 'acceptance.json')

export interface AcceptanceStore {
  records: AcceptanceRecord[]
  wins: Record<string, number>
}

export function loadAcceptanceStore(file = DEFAULT_ACCEPTANCE_FILE): AcceptanceStore {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as { records?: AcceptanceRecord[] }
    const records = Array.isArray(parsed.records) ? parsed.records : []
    return { records, wins: winsFromRecords(records) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { records: [], wins: {} }
    throw err
  }
}

export function winsFromRecords(records: AcceptanceRecord[]): Record<string, number> {
  const wins: Record<string, number> = {}
  for (const record of records) {
    if (record.outcome !== 'accepted') continue
    wins[record.worldId] = (wins[record.worldId] ?? 0) + 1
  }
  return wins
}

export function recordAcceptance(
  worldId: string,
  outcome: AcceptanceOutcome,
  options: { note?: string; at?: string; file?: string } = {},
): AcceptanceStore {
  const file = options.file ?? DEFAULT_ACCEPTANCE_FILE
  const store = loadAcceptanceStore(file)
  const record: AcceptanceRecord = {
    worldId,
    outcome,
    at: options.at ?? new Date().toISOString(),
    ...(options.note?.trim() ? { note: options.note.trim() } : {}),
  }
  store.records.push(record)
  store.wins = winsFromRecords(store.records)

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ records: store.records }, null, 2) + '\n', 'utf8')
  return store
}

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadAcceptanceStore, recordAcceptance, winsFromRecords } from '@/lib/direction-deck/acceptance'
import type { AcceptanceRecord } from '@/lib/direction-deck/types'

describe('direction-deck acceptance recording', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direction-deck-'))
    file = path.join(dir, 'acceptance.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts with an empty store when no ledger exists', () => {
    const store = loadAcceptanceStore(file)
    expect(store.records).toEqual([])
    expect(store.wins).toEqual({})
  })

  it('records acceptance and increments wins', () => {
    const store = recordAcceptance('swiss-modern', 'accepted', { file })
    expect(store.wins['swiss-modern']).toBe(1)
    const again = recordAcceptance('swiss-modern', 'accepted', { file })
    expect(again.wins['swiss-modern']).toBe(2)
  })

  it('rejection does not count as a win', () => {
    const store = recordAcceptance('coastal-calm', 'rejected', { file })
    expect(store.wins['coastal-calm'] ?? 0).toBe(0)
    expect(store.records).toHaveLength(1)
  })

  it('persists records to disk and reloads them', () => {
    recordAcceptance('artisan-letterpress', 'accepted', { file, note: 'client loved it' })
    const store = loadAcceptanceStore(file)
    expect(store.records).toHaveLength(1)
    expect(store.records[0].worldId).toBe('artisan-letterpress')
    expect(store.records[0].outcome).toBe('accepted')
    expect(store.records[0].note).toBe('client loved it')
    expect(store.wins['artisan-letterpress']).toBe(1)
  })

  it('winsFromRecords aggregates only accepted outcomes', () => {
    const records: AcceptanceRecord[] = [
      { worldId: 'a', outcome: 'accepted', at: 't1' },
      { worldId: 'a', outcome: 'accepted', at: 't2' },
      { worldId: 'b', outcome: 'rejected', at: 't3' },
      { worldId: 'c', outcome: 'accepted', at: 't4' },
    ]
    expect(winsFromRecords(records)).toEqual({ a: 2, c: 1 })
  })
})

/**
 * Regression: multi-kind volume must not drop cron/hooks when many checkpoints exist.
 * Binds FirestoreHermesFeaturesRepository (not Memory maps) with an in-memory doc store.
 * Asserts list path is aggregate single-get (no where/scan).
 */
import {
  FirestoreHermesFeaturesRepository,
  createInMemoryDocStore,
  docId,
  readAggregateItems,
  upsertAggregateItem,
} from '@/lib/hermes-features/repository'
import type { CheckpointSnapshot, CronJobSpec } from '@/lib/hermes-features/types'

describe('FirestoreHermesFeaturesRepository aggregate list shape', () => {
  it('pure upsertAggregateItem keeps cron when 120 other ids exist', () => {
    let items: Array<{ id: string }> = []
    for (let i = 0; i < 120; i++) {
      items = upsertAggregateItem(items, { id: `chk_${i}` }, (r) => r.id, { prepend: true })
    }
    items = upsertAggregateItem(items, { id: 'cron_only' }, (r) => r.id)
    expect(items.find((r) => r.id === 'cron_only')).toBeTruthy()
    expect(items.length).toBe(121)
  })

  it('listCron returns the cron after 120 checkpoints for same org (Firestore repo path)', async () => {
    const store = createInMemoryDocStore()
    const whereSpy = jest.spyOn(store, 'where')
    const repo = new FirestoreHermesFeaturesRepository(store)
    const orgId = 'org-volume'

    // Flood with 120 checkpoints (same failure mode as multi-kind page limits).
    for (let i = 0; i < 120; i++) {
      const snap: CheckpointSnapshot = {
        id: `chk_${i}`,
        orgId,
        conversationId: 'conv-a',
        label: `cp ${i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        files: { [`f${i}.txt`]: String(i) },
      }
      await repo.addCheckpoint(snap)
    }

    const job: CronJobSpec = {
      id: 'cron_survive',
      orgId,
      agentId: 'pip',
      name: 'survives volume',
      schedule: '@daily',
      prompt: 'still here',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await repo.upsertCron(job)

    const listed = await repo.listCron(orgId)
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe('cron_survive')
    expect(listed[0].prompt).toBe('still here')

    // Checkpoints still complete under aggregate (not lost either)
    const checkpoints = await repo.listCheckpoints(orgId, 'conv-a')
    expect(checkpoints.length).toBe(100) // max 100 prepend cap
    expect(checkpoints.some((c) => c.id === 'chk_119')).toBe(true)

    // list* must not scan via where()
    expect(whereSpy).not.toHaveBeenCalled()

    // Aggregate doc shape: single cron doc holds items array
    const cronDoc = store.docs.get(docId(['cron', orgId]))
    expect(cronDoc?.kind).toBe('cron')
    const items = readAggregateItems((cronDoc?.payload as { items?: CronJobSpec[] }) || null)
    expect(items.map((j) => (j as CronJobSpec).id)).toContain('cron_survive')
  })

  it('processDue-style listCron still finds active jobs after many checkpoint writes', async () => {
    const store = createInMemoryDocStore()
    const repo = new FirestoreHermesFeaturesRepository(store)
    const orgId = 'org-due'

    await repo.upsertCron({
      id: 'due_1',
      orgId,
      agentId: 'pip',
      name: 'due',
      schedule: '@hourly',
      prompt: 'fire me',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    for (let i = 0; i < 150; i++) {
      await repo.addCheckpoint({
        id: `x_${i}`,
        orgId,
        conversationId: 'c1',
        label: 'flood',
        createdAt: new Date().toISOString(),
        files: {},
      })
      // workspace docs also written in real system — unrelated aggregate
      await repo.setWorkspaceFiles(orgId, 'c1', { [`w${i}`]: '1' })
    }

    const cron = await repo.listCron(orgId)
    expect(cron.map((j) => j.id)).toEqual(['due_1'])
    expect(cron[0].status).toBe('active')
  })

  it('hooks and mcp aggregates are independent of checkpoint volume', async () => {
    const store = createInMemoryDocStore()
    const repo = new FirestoreHermesFeaturesRepository(store)
    const orgId = 'org-indep'

    for (let i = 0; i < 80; i++) {
      await repo.addCheckpoint({
        id: `c_${i}`,
        orgId,
        conversationId: 'c',
        label: 'x',
        createdAt: new Date().toISOString(),
        files: {},
      })
    }
    await repo.upsertHook({
      id: 'h1',
      orgId,
      kind: 'gateway_log',
      name: 'log',
      enabled: true,
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await repo.upsertMcp({
      id: 'm1',
      orgId,
      name: 'gh',
      transport: 'http',
      endpoint: 'https://example.com/mcp',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    expect(await repo.listHooks(orgId)).toHaveLength(1)
    expect(await repo.listMcp(orgId)).toHaveLength(1)
    expect((await repo.listHooks(orgId))[0].id).toBe('h1')
  })
})

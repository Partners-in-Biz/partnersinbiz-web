/**
 * Cron orchestration + package surface for Workflow Graph Phase 2 ops.
 * Proves Quinn blockers: barrel exports cron imports, stuck SLA → one deduped fact.
 */

const saveOpsFactMock = jest.fn(async (fact: { dedupeKey: string }) => ({
  written: true,
  fact: { ...fact, id: fact.dedupeKey },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ exists: false })),
        set: jest.fn(async () => undefined),
        id: 'mock-doc',
      })),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({ empty: true, docs: [] })),
      add: jest.fn(async () => ({ id: 'mock-add' })),
    })),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args: unknown[]) => args),
  },
}))

jest.mock('@/lib/workflow-graph/store', () => {
  const actual = jest.requireActual('@/lib/workflow-graph/store') as typeof import('@/lib/workflow-graph/store')
  return {
    ...actual,
    saveOpsFact: (...args: unknown[]) => saveOpsFactMock(...(args as [ { dedupeKey: string } ])),
  }
})

import * as workflowGraph from '@/lib/workflow-graph'
import {
  advanceWorkflowRun,
  bindKanbanTask,
  createWorkflowRunFromTemplate,
} from '@/lib/workflow-graph/engine'
import { buildPilotResearchValidateDocApproveFanoutTemplate } from '@/lib/workflow-graph/pilot'
import { DEFAULT_SLA } from '@/lib/workflow-graph/constants'
import type { WorkflowRun } from '@/lib/workflow-graph/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const NOW = '2026-08-02T12:00:00.000Z'

function startPilotRun(): WorkflowRun {
  const template = buildPilotResearchValidateDocApproveFanoutTemplate({
    orgId: 'pib-platform-owner',
    projectId: 'proj-pilot',
  })
  template.id = 'tmpl-pilot'
  return createWorkflowRunFromTemplate({
    runId: 'wfr_cron_1',
    template,
    orgId: 'pib-platform-owner',
    projectId: 'proj-pilot',
    trigger: { type: 'manual', at: NOW },
    now: NOW,
    createdBy: 'theo',
  })
}

describe('workflow graph phase 2 cron orchestration', () => {
  beforeEach(() => {
    saveOpsFactMock.mockClear()
    saveOpsFactMock.mockImplementation(async (fact: { dedupeKey: string }) => ({
      written: true,
      fact: { ...fact, id: fact.dedupeKey },
    }))
  })

  test('package surface exports what cron route imports', () => {
    expect(typeof workflowGraph.saveWorkflowRun).toBe('function')
    expect(typeof workflowGraph.finalizeOpsSideEffects).toBe('function')
    expect(typeof workflowGraph.handleCronTriggerTick).toBe('function')
    expect(typeof workflowGraph.listOpsWorkflowRuns).toBe('function')
    expect(typeof workflowGraph.applyStuckEvaluation).toBe('function')

    // Static check: cron route source imports from barrel, and barrel lists symbols
    const root = join(__dirname, '../..')
    const barrel = readFileSync(join(root, 'lib/workflow-graph/index.ts'), 'utf8')
    expect(barrel).toMatch(/saveWorkflowRun/)
    expect(barrel).toMatch(/finalizeOpsSideEffects/)
    const cronRoute = readFileSync(join(root, 'app/api/cron/workflow-graph/route.ts'), 'utf8')
    expect(cronRoute).toMatch(/from '@\/lib\/workflow-graph'/)
    expect(cronRoute).toMatch(/finalizeOpsSideEffects/)
    expect(cronRoute).toMatch(/saveWorkflowRun/)
    expect(cronRoute).not.toMatch(/applyStuckEvaluation/)

    const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>
    }
    const entry = vercel.crons.find((c) => c.path.includes('/api/cron/workflow-graph'))
    expect(entry).toBeTruthy()
    expect(entry!.schedule).toBe('*/5 * * * *')
    expect(entry!.path).toContain('orgId=pib-platform-owner')
  })

  test('stuck SLA transition emits one deduped block/stuck fact via finalizeOpsSideEffects', async () => {
    let run = startPilotRun()
    const step = advanceWorkflowRun(run, { type: 'tick', now: NOW })
    run = bindKanbanTask(step.run, 'research_brief', 'task-research', NOW)
    const node = run.nodes.find((n) => n.nodeId === 'research_brief')!
    node.status = 'waiting_watcher'
    node.lastTransitionAt = NOW
    run.notify = { quietSuccess: true, alertOnBlock: true }

    const later = new Date(Date.parse(NOW) + (DEFAULT_SLA.agentRunningHeartbeatMs! + 60_000)).toISOString()
    const previous = { ...run, nodes: run.nodes.map((n) => ({ ...n })) }

    const finalized = await workflowGraph.finalizeOpsSideEffects(previous, run, later)

    expect(finalized.stuckReasonCode).toMatch(/agent_heartbeat_stale|agent_running_stale/)
    expect(finalized.stuckAt).toBeTruthy()
    expect(finalized.blockRevision).toBe(1)
    expect(finalized.lastAlertDedupeKey).toBe('wfr_cron_1:block:1')

    expect(saveOpsFactMock).toHaveBeenCalledTimes(1)
    const fact = saveOpsFactMock.mock.calls[0][0] as {
      kind: string
      dedupeKey: string
      reasonCode?: string
      workflowRunId: string
    }
    expect(fact.kind).toBe('stuck')
    expect(fact.dedupeKey).toBe('wfr_cron_1:block:1')
    expect(fact.workflowRunId).toBe('wfr_cron_1')
    expect(String(fact.reasonCode)).toMatch(/agent_heartbeat_stale|agent_running_stale/)

    // Second call same revision must not write again (dedupe key already on run)
    saveOpsFactMock.mockClear()
    const again = await workflowGraph.finalizeOpsSideEffects(finalized, finalized, later)
    expect(again.lastAlertDedupeKey).toBe('wfr_cron_1:block:1')
    expect(saveOpsFactMock).not.toHaveBeenCalled()
  })
})

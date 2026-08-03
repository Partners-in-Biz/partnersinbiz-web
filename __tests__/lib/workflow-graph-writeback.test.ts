/**
 * Write-back perfection contract for Workflow Graph.
 * Pure stamp/evidence rules mirror services/agent-watcher/src/workflow-writeback.ts.
 */

function extractWorkflowStamp(taskData: Record<string, unknown>): {
  runId: string
  nodeId: string
  orgId: string
} | null {
  const runId = typeof taskData.workflowRunId === 'string' ? taskData.workflowRunId.trim() : ''
  const nodeId = typeof taskData.workflowNodeId === 'string' ? taskData.workflowNodeId.trim() : ''
  if (!runId || !nodeId) return null
  const orgId = typeof taskData.orgId === 'string' ? taskData.orgId.trim() : ''
  return { runId, nodeId, orgId }
}

function extractEvidenceFromAgentOutput(agentOutput: unknown): Array<{ type: string; ref: string; label?: string }> {
  const evidence: Array<{ type: string; ref: string; label?: string }> = []
  if (!agentOutput || typeof agentOutput !== 'object') return evidence
  const output = agentOutput as Record<string, unknown>

  if (Array.isArray(output.artifacts)) {
    for (const raw of output.artifacts) {
      if (!raw || typeof raw !== 'object') continue
      const artifact = raw as Record<string, unknown>
      const type =
        typeof artifact.type === 'string'
          ? artifact.type
          : typeof artifact.label === 'string'
            ? artifact.label
            : ''
      const ref = typeof artifact.ref === 'string' ? artifact.ref : ''
      if (type && ref) {
        evidence.push({
          type,
          ref,
          label: typeof artifact.label === 'string' ? artifact.label : undefined,
        })
      }
    }
  }

  for (const key of [
    'research_doc_id',
    'draft_doc_id',
    'eng_checklist_id',
    'content_checklist_id',
    'approval_ref',
  ]) {
    const value = output[key]
    if (typeof value === 'string' && value.trim()) {
      evidence.push({ type: key, ref: value.trim() })
    }
  }

  return evidence
}

describe('workflow graph write-back perfection', () => {
  test('extractWorkflowStamp requires both run and node ids', () => {
    expect(extractWorkflowStamp({})).toBeNull()
    expect(extractWorkflowStamp({ workflowRunId: 'wfr_1' })).toBeNull()
    expect(extractWorkflowStamp({ workflowNodeId: 'n1' })).toBeNull()
    expect(extractWorkflowStamp({
      workflowRunId: 'wfr_1',
      workflowNodeId: 'research_brief',
      orgId: 'pib-platform-owner',
    })).toEqual({
      runId: 'wfr_1',
      nodeId: 'research_brief',
      orgId: 'pib-platform-owner',
    })
  })

  test('extractEvidenceFromAgentOutput pulls artifacts and known pilot keys', () => {
    const evidence = extractEvidenceFromAgentOutput({
      summary: 'ok',
      artifacts: [
        { type: 'commit', ref: 'abc123', label: 'engine' },
        { type: 'bad' },
      ],
      research_doc_id: 'doc_research_1',
      draft_doc_id: '  draft_9  ',
      approval_ref: 'appr_1',
    })
    expect(evidence).toEqual(expect.arrayContaining([
      { type: 'commit', ref: 'abc123', label: 'engine' },
      { type: 'research_doc_id', ref: 'doc_research_1' },
      { type: 'draft_doc_id', ref: 'draft_9' },
      { type: 'approval_ref', ref: 'appr_1' },
    ]))
  })

  test('barrel exports processWorkflowWritebackOutbox for cron drain', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const barrel = require('@/lib/workflow-graph') as typeof import('@/lib/workflow-graph')
    expect(typeof barrel.processWorkflowWritebackOutbox).toBe('function')
    expect(typeof barrel.handleKanbanTaskTerminalForWorkflow).toBe('function')
  })

  test('cron route source drains writeback outbox before stuck pass', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const src = readFileSync(join(process.cwd(), 'app/api/cron/workflow-graph/route.ts'), 'utf8')
    expect(src).toContain('processWorkflowWritebackOutbox')
    expect(src).toContain('writeback')
  })

  test('task PATCH awaits write-back (no fire-and-forget)', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const src = readFileSync(join(process.cwd(), 'app/api/v1/projects/[projectId]/tasks/[taskId]/route.ts'), 'utf8')
    expect(src).toContain('await handleKanbanTaskTerminalForWorkflow')
    expect(src).not.toMatch(/void import\('@\/lib\/workflow-graph'\)\.then/)
  })

  test('watcher source notifies workflow graph on terminal states', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const watcher = readFileSync(join(process.cwd(), 'services/agent-watcher/src/watcher.ts'), 'utf8')
    const writeback = readFileSync(join(process.cwd(), 'services/agent-watcher/src/workflow-writeback.ts'), 'utf8')
    expect(watcher).toContain("from './workflow-writeback'")
    expect(watcher).toContain('notifyWorkflowGraphTerminal')
    expect(writeback).toContain('workflow_writeback_outbox')
    expect(writeback).toContain('/workflow-runs/')
  })
})

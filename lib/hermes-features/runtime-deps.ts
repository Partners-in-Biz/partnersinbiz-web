/**
 * Production wiring: create Hermes runs for cron fire + delegation children.
 * Injectable in tests.
 */
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
import { createHermesRun } from '@/lib/hermes/server'
import { callAgentPath } from '@/lib/agents/team'
import type { AgentId } from '@/lib/agents/types'
import type { CronHermesSyncDeps } from './cron-runtime'
import type { DelegationRunDeps } from './delegation-runtime'

export function productionCronDeps(): CronHermesSyncDeps {
  return {
    syncToHermes: async (agentId, body) => {
      try {
        const { response, data } = await callAgentPath(agentId as AgentId, '/admin/cron', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        return {
          ok: response.ok,
          detail: response.ok ? 'synced to Hermes admin cron' : JSON.stringify(data).slice(0, 300),
        }
      } catch (err) {
        return {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        }
      }
    },
    createRun: async ({ orgId, agentId, prompt, jobId }) => {
      try {
        const link = await getAgentDispatchHermesProfileLink(agentId, orgId)
        if (!link) return { ok: false, error: `No Hermes profile link for agent ${agentId}` }
        const result = await createHermesRun(link, `hermes-features-cron:${jobId}`, {
          prompt,
          conversation_id: `cron:${jobId}`,
          metadata: {
            source: 'hermes-features-cron',
            jobId,
            dispatchAgentId: agentId,
            orgId,
          },
        })
        if (!result.ok) {
          return { ok: false, error: result.dispatchError?.message || `Hermes run failed (${result.status})` }
        }
        const runId =
          (result.data as { runId?: string; id?: string })?.runId ||
          (result.data as { runId?: string; id?: string })?.id ||
          result.runDocId ||
          undefined
        return { ok: true, runId: runId || undefined }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

export function productionDelegationDeps(): DelegationRunDeps {
  return {
    createRun: async ({ orgId, agentId, conversationId, goal, context, childId, parentRunHint }) => {
      try {
        const link = await getAgentDispatchHermesProfileLink(agentId, orgId)
        if (!link) return { ok: false, error: `No Hermes profile link for agent ${agentId}` }
        // Isolated child: only goal+context enter the prompt (Hermes-style).
        const prompt = [
          '[Hermes subagent delegation — child run]',
          `parent: ${parentRunHint}`,
          `childId: ${childId}`,
          `agent: ${agentId}`,
          '',
          'You start with a fresh context. Use only the goal and context below.',
          'Do not re-delegate. Return a structured summary of what you did, findings, and issues.',
          '',
          '## Goal',
          goal,
          ...(context ? ['', '## Context', context] : []),
        ].join('\n')
        const result = await createHermesRun(link, `hermes-features-delegation:${childId}`, {
          prompt,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          metadata: {
            source: 'hermes-features-delegation',
            childId,
            parentRunHint,
            dispatchAgentId: agentId,
            orgId,
            ...(conversationId ? { conversationId } : {}),
          },
        })
        if (!result.ok) {
          return { ok: false, error: result.dispatchError?.message || `Hermes run failed (${result.status})` }
        }
        const runId =
          (result.data as { runId?: string; id?: string })?.runId ||
          (result.data as { runId?: string; id?: string })?.id ||
          undefined
        return {
          ok: true,
          runId,
          runDocId: result.runDocId || undefined,
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

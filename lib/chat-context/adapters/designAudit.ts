/**
 * Design Audit chat-context adapter — resolves a `design` context reference
 * (a design audit run id) into a Messages Context Dock read model so the
 * "Open design audit" canvas renders findings grouped P0-P3, severity
 * metrics, waivers, and the audited URL. Org-scoped: reads only runs the
 * caller's org owns.
 */

import type { ChatContextAdapter, ChatContextResolveInput, ChatContextResolveResult } from '@/lib/chat-context/access'
import type { ContextDisplayState } from '@/lib/chat-context/types'
import { getDesignAuditRun, type DesignAuditRun } from '@/lib/design-audit/audit-runs'

function stateForRun(run: DesignAuditRun): ContextDisplayState {
  if (run.status === 'failed') return 'blocked'
  if (run.exitCode === 0 && run.findings.length === 0) return 'complete'
  return 'review'
}

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function findingLabel(finding: DesignAuditRun['findings'][number]): string {
  const value = finding.value ? ` (${finding.value})` : ''
  return `${finding.rule}${value} · ${finding.ref}${finding.line ? `:${finding.line}` : ''} — ${finding.message}`
}

export const designAuditChatContextAdapter: ChatContextAdapter = {
  async resolve(input: ChatContextResolveInput): Promise<ChatContextResolveResult> {
    if (input.kind !== 'design') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported design context' }
    }
    const orgId = input.user.activeOrgId ?? input.user.orgId
    if (!orgId) return { ok: false, reason: 'forbidden', status: 403, error: 'No organisation scope' }
    const run = await getDesignAuditRun(orgId, input.id)
    if (!run) return { ok: false, reason: 'not_found', status: 404, error: 'Design audit run not found' }

    const grouped: Record<string, typeof run.findings> = { P0: [], P1: [], P2: [], P3: [] }
    for (const finding of run.findings) {
      ;(grouped[finding.severity] ??= []).push(finding)
    }
    const severityOrder = ['P0', 'P1', 'P2', 'P3'] as const
    const groups = severityOrder
      .map((severity) => {
        const findings = grouped[severity] ?? []
        if (findings.length === 0) return null
        return {
          id: `findings-${severity}`,
          label: `${severity} findings`,
          items: findings.slice(0, 25).map((finding) => ({
            id: `${severity}:${finding.rule}:${finding.ref}:${finding.line}`,
            label: finding.rule,
            state: severity === 'P0' ? 'blocked' as const : severity === 'P1' ? 'needs_input' as const : 'review' as const,
            detail: findingLabel(finding),
          })),
        }
      })
      .filter((group): group is NonNullable<typeof group> => Boolean(group))

    const total = run.summary?.total ?? run.findings.length
    const state = stateForRun(run)
    const metrics = [
      { id: 'exit', label: 'Exit code', value: run.exitCode ?? 'n/a' },
      { id: 'total', label: 'Findings', value: total },
      { id: 'p0', label: 'P0', value: run.summary?.bySeverity.P0 ?? 0 },
      { id: 'p1', label: 'P1', value: run.summary?.bySeverity.P1 ?? 0 },
      { id: 'p2', label: 'P2', value: run.summary?.bySeverity.P2 ?? 0 },
      { id: 'p3', label: 'P3', value: run.summary?.bySeverity.P3 ?? 0 },
    ]

    const attention = []
    if (run.status === 'failed') {
      attention.push({
        id: 'audit-failed',
        label: 'Audit failed',
        state: 'blocked' as const,
        detail: clean(run.error ?? run.errors.join(' · '), 200) || 'The design audit could not complete.',
      })
    }
    if ((grouped.P0?.length ?? 0) > 0) {
      attention.push({
        id: 'p0-findings',
        label: `${grouped.P0!.length} P0 finding${grouped.P0!.length === 1 ? '' : 's'}`,
        state: 'blocked' as const,
        detail: 'P0 findings are the highest-priority design/a11y failures — fix before shipping.',
      })
    }
    if (run.waivers.length > 0) {
      attention.push({
        id: 'waivers',
        label: `${run.waivers.length} waived finding${run.waivers.length === 1 ? '' : 's'}`,
        state: 'review' as const,
        detail: run.waivers.slice(0, 3).map((waiver) => `${waiver.rule} — ${clean(waiver.reason, 80)}`).join(' · '),
      })
    }

    return {
      ok: true,
      model: {
        context: {
          kind: 'design',
          id: run.id,
          orgId,
          label: clean(run.url, 160) || 'Design audit',
          icon: 'palette',
        },
        pulse: {
          label: 'Design audit',
          metrics,
          headline: `${run.scope} audit · ${run.url}`,
          next: attention[0]
            ? {
                id: attention[0].id,
                label: attention[0].label,
                state: attention[0].state,
                detail: attention[0].detail,
              }
            : undefined,
        },
        groups,
        artifacts: [],
        attention,
        activity: [],
        preview: {
          kind: 'summary',
          text: `${state === 'complete' ? 'Clean' : state === 'blocked' ? 'Failed' : `${total} findings`} · ${run.scope} · ${run.url}`,
          status: run.status === 'failed' ? 'failed' : state === 'complete' ? 'complete' : 'review',
        },
        capabilities: ['preview', 'findings', 'waivers'],
        asOf: new Date().toISOString(),
      },
    }
  },
}

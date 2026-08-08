/**
 * Design Iteration chat-context adapter — resolves a `design` context
 * reference whose id is a design-iteration session (`di_`-prefixed) into a
 * Messages Context Dock read model: the variant deck (baseline URL,
 * instruction, one group per variant with archetype + status), decision
 * attention, and apply summary. Org-scoped: reads only sessions the caller's
 * org owns. The `dar_`-prefixed audit-run path stays in designAudit.ts.
 */

import type { ChatContextAdapter, ChatContextResolveInput, ChatContextResolveResult } from '@/lib/chat-context/access'
import type { ContextDisplayState } from '@/lib/chat-context/types'
import { getDesignIterationSession } from '@/lib/design-iteration/store'
import type { DesignIterationSession } from '@/lib/design-iteration/types'

function stateForSession(session: DesignIterationSession): ContextDisplayState {
  if (session.status === 'applied') return 'complete'
  if (session.status === 'accepted') return 'needs_input'
  if (session.status === 'rejected') return 'blocked'
  return 'review'
}

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function variantState(status: DesignIterationSession['variants'][number]['status']): ContextDisplayState {
  if (status === 'accepted') return 'complete'
  if (status === 'rejected') return 'blocked'
  return 'review'
}

export const designIterationChatContextAdapter: ChatContextAdapter = {
  async resolve(input: ChatContextResolveInput): Promise<ChatContextResolveResult> {
    if (input.kind !== 'design') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported design context' }
    }
    const orgId = input.user.activeOrgId ?? input.user.orgId
    if (!orgId) return { ok: false, reason: 'forbidden', status: 403, error: 'No organisation scope' }
    const session = await getDesignIterationSession(orgId, input.id)
    if (!session) return { ok: false, reason: 'not_found', status: 404, error: 'Design iteration session not found' }

    const accepted = session.variants.find((variant) => variant.status === 'accepted')
    const pending = session.variants.filter((variant) => variant.status === 'pending').length
    const groups = session.variants.map((variant, index) => ({
      id: `variant-${variant.id}`,
      label: `${variant.archetype} (${variant.status})`,
      items: [
        {
          id: `variant-${variant.id}-desc`,
          label: variant.changeType === 'image-mock' ? 'Image mock' : 'DOM/CSS edit',
          state: variantState(variant.status),
          detail: clean(variant.description, 400),
        },
        ...(variant.decisionNote
          ? [{ id: `variant-${variant.id}-note`, label: 'Decision note', state: variantState(variant.status), detail: clean(variant.decisionNote, 300) }]
          : []),
        ...(variant.screenshotUrl
          ? [{ id: `variant-${variant.id}-preview`, label: 'Preview', state: 'review' as const, detail: variant.screenshotUrl }]
          : []),
      ],
    }))

    const state = stateForSession(session)
    const metrics = [
      { id: 'variants', label: 'Variants', value: session.variants.length },
      { id: 'pending', label: 'Pending', value: pending },
      { id: 'accepted', label: 'Accepted', value: session.variants.filter((variant) => variant.status === 'accepted').length },
      { id: 'rejected', label: 'Rejected', value: session.variants.filter((variant) => variant.status === 'rejected').length },
    ]

    const attention = []
    if (session.status === 'applied' && session.apply) {
      attention.push({
        id: 'applied',
        label: 'Applied to repo',
        state: 'review' as const,
        detail: `${session.apply.repo} (${session.apply.branch}) — ${clean(session.apply.diffSummary, 300)}`,
      })
      if (typeof session.apply.detectorExitCode === 'number') {
        attention.push({
          id: 'detector',
          label: `T1 detector exit ${session.apply.detectorExitCode}`,
          state: session.apply.detectorExitCode === 0 ? 'review' as const : 'blocked' as const,
          detail: `${session.apply.detectorFindings ?? 0} findings ${session.apply.detectorSummary ? `— ${clean(session.apply.detectorSummary, 200)}` : ''}`,
        })
      }
    } else if (accepted) {
      attention.push({
        id: 'accepted-variant',
        label: `Accepted: ${accepted.archetype}`,
        state: 'needs_input' as const,
        detail: 'The agent will write this change to the approved repo on development, run the T1 detector, and report the diff.',
      })
    } else if (pending > 0) {
      attention.push({
        id: 'awaiting-decision',
        label: `${pending} variant${pending === 1 ? '' : 's'} awaiting decision`,
        state: 'review' as const,
        detail: 'Tap Accept or Reject on the card buttons to decide.',
      })
    }

    return {
      ok: true,
      model: {
        context: {
          kind: 'design',
          id: session.id,
          orgId,
          label: clean(session.url, 160) || 'Design this page',
          icon: 'palette',
        },
        pulse: {
          label: 'Design this page',
          metrics,
          headline: `${session.variants.length} variant${session.variants.length === 1 ? '' : 's'} · ${session.url}`,
          next: attention[0]
            ? { id: attention[0].id, label: attention[0].label, state: attention[0].state, detail: attention[0].detail }
            : undefined,
        },
        groups,
        artifacts: [],
        attention,
        activity: [],
        preview: {
          kind: 'summary',
          text: `${state === 'complete' ? 'Applied' : accepted ? `Accepted: ${accepted.archetype}` : `${pending} pending`} · ${session.url}`,
          status: session.status === 'applied' ? 'complete' : session.status === 'rejected' ? 'failed' : 'review',
        },
        capabilities: ['preview', 'variants', 'decisions'],
        asOf: new Date().toISOString(),
      },
    }
  },
}

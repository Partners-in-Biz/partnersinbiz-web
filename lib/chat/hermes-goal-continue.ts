/**
 * After a Hermes run completes in Messages, advance standing /goal state and
 * optionally dispatch an automatic continuation turn.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { createHermesRun } from '@/lib/hermes/server'
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
import {
  createMessage,
  getConversation,
  messagesCollection,
  patchConversation,
  touchConversation,
} from '@/lib/conversations/conversations'
import { resolveConversationDispatchAgentId } from '@/lib/conversations/dispatch-agent'
import type { AgentId } from '@/lib/conversations/types'
import {
  advanceGoalAfterTurn,
  buildHermesGoalWorkPrompt,
  type HermesGoalState,
} from '@/lib/chat/hermes-goal'
import { buildCeoDataDecisionOperatingRuleLines } from '@/lib/agent/ceo-operating-rule'

function decisionRuleBlock(): string {
  return `${buildCeoDataDecisionOperatingRuleLines().join('\n')}\n\n`
}

export async function maybeContinueConversationGoal(input: {
  convId: string
  completedAssistantMessageId: string
  assistantContent: string
  runId?: string
}): Promise<{ continued: boolean; notice?: string }> {
  const conversation = await getConversation(input.convId)
  if (!conversation) return { continued: false }

  const goalState = (conversation.goalState ?? null) as HermesGoalState | null
  if (!goalState || goalState.status !== 'active' || !goalState.goal) {
    return { continued: false }
  }

  // Avoid double-continuing the same assistant message.
  if (
    goalState.lastAssistantMessageId
    && goalState.lastAssistantMessageId === input.completedAssistantMessageId
  ) {
    return { continued: false }
  }

  // Skip continuation for system/goal notice messages themselves.
  const completedSnap = await messagesCollection(input.convId).doc(input.completedAssistantMessageId).get()
  const completedData = completedSnap.data() ?? {}
  if (completedData.authorKind === 'system' || completedData.authorId === 'system') {
    return { continued: false }
  }
  if (completedData.source === 'pib-goal-notice') {
    return { continued: false }
  }

  const advanced = advanceGoalAfterTurn(goalState, input.assistantContent, {
    runId: input.runId,
    assistantMessageId: input.completedAssistantMessageId,
  })
  await patchConversation(input.convId, { goalState: advanced.state })

  // Post a short system notice into the thread for pause/done/continue.
  const noticeMessage = await createMessage(input.convId, {
    conversationId: input.convId,
    role: 'assistant',
    content: advanced.notice,
    authorKind: 'system',
    authorId: 'system',
    authorDisplayName: 'Goals',
    status: 'completed',
  })
  await touchConversation(input.convId, advanced.notice, 'assistant', noticeMessage.id)

  if (!advanced.shouldContinue || advanced.state.status !== 'active') {
    return { continued: false, notice: advanced.notice }
  }

  const agentId = await resolveConversationDispatchAgentId(conversation)
  if (!agentId) return { continued: false, notice: advanced.notice }

  const runtimeTarget = conversation.workspaceContext?.runtimeTarget?.trim() || undefined
  const agentLink = await getAgentDispatchHermesProfileLink(
    agentId as AgentId,
    conversation.orgId,
    runtimeTarget ? { runtimeTarget } : {},
  )
  if (!agentLink) return { continued: false, notice: advanced.notice }

  const pendingAssistant = await createMessage(input.convId, {
    conversationId: input.convId,
    role: 'assistant',
    content: '',
    authorKind: 'agent',
    authorId: agentId,
    authorDisplayName: agentId,
    status: 'pending',
    dispatchAgentId: agentId as AgentId,
  })

  const workPrompt = buildHermesGoalWorkPrompt(advanced.state, 'continue')
  const hermesInput = `${decisionRuleBlock()}${workPrompt}`

  const runResult = await createHermesRun(agentLink, conversation.startedBy || 'goal-continue', {
    prompt: hermesInput,
    conversation_id: input.convId,
    dispatch: {
      requestedRuntimeTargetId: conversation.workspaceContext?.runtimeTarget ?? agentLink.runtimeTargetId,
    },
    metadata: {
      conversationId: input.convId,
      messageId: pendingAssistant.id,
      orgId: conversation.orgId,
      dispatchAgentId: agentId,
      source: 'pib-goal-continue',
      goalContinuation: true,
      parentAssistantMessageId: input.completedAssistantMessageId,
    },
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : 'Goal continuation failed to start'
    await messagesCollection(input.convId).doc(pendingAssistant.id).update({
      content: message,
      status: 'failed',
      error: message,
    })
    return null
  })

  if (!runResult || !runResult.ok) {
    const message = runResult?.dispatchError?.message || 'Goal continuation failed to start'
    await messagesCollection(input.convId).doc(pendingAssistant.id).update({
      content: message,
      status: 'failed',
      error: message,
    })
    return { continued: false, notice: advanced.notice }
  }

  const hermesRunId = runResult.data?.runId || ''
  await messagesCollection(input.convId).doc(pendingAssistant.id).update({
    status: 'pending',
    ...(hermesRunId ? { runId: hermesRunId } : { runId: FieldValue.delete() }),
    ...(runResult.runDocId ? { runDocId: runResult.runDocId } : {}),
    dispatchAgentId: agentId,
  })

  await patchConversation(input.convId, {
    goalState: {
      ...advanced.state,
      lastRunId: hermesRunId || advanced.state.lastRunId,
      lastAssistantMessageId: pendingAssistant.id,
      updatedAt: new Date().toISOString(),
    },
  })

  return { continued: true, notice: advanced.notice }
}

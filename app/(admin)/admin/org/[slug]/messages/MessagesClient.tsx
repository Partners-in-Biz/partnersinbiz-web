'use client'

import { useEffect, useState } from 'react'
import UnifiedChat from '@/components/chat/UnifiedChat'
import AgentRunSession from '@/components/agents/AgentRunSession'

interface MessagesClientProps {
  orgId: string
  uid: string
  displayName: string
  orgSlug: string
  initialConvId?: string
  initialAgentId?: string
  initialRunId?: string
  initialTaskId?: string
  initialTaskTitle?: string
}

export default function MessagesClient({
  orgId,
  uid,
  displayName,
  orgSlug,
  initialConvId,
  initialAgentId,
  initialRunId,
  initialTaskId,
  initialTaskTitle,
}: MessagesClientProps) {
  const [showIntro, setShowIntro] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setShowIntro(false), 3000)
    return () => window.clearTimeout(timer)
  }, [])

  if (initialAgentId && initialRunId) {
    return (
      <AgentRunSession
        agentId={initialAgentId}
        runId={initialRunId}
        orgId={orgId}
        orgSlug={orgSlug}
        currentUserUid={uid}
        currentUserDisplayName={displayName}
        taskId={initialTaskId}
        taskTitle={initialTaskTitle}
      />
    )
  }

  return (
    <div
      className="flex min-h-[640px] flex-col overflow-hidden h-[calc(100dvh-120px)]"
    >
      <div className={[
        'hidden shrink-0 overflow-hidden transition-all duration-700 ease-out lg:block',
        showIntro ? 'mb-4 max-h-24 translate-y-0 opacity-100' : 'mb-0 max-h-0 -translate-y-2 opacity-0',
      ].join(' ')}>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Workspace / Messages
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Messages</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Multi-participant conversations with your team and agents.
        </p>
      </div>

      <UnifiedChat
        orgId={orgId}
        currentUserUid={uid}
        currentUserDisplayName={displayName}
        initialConvId={initialConvId}
        allowDeleteConversations
      />
    </div>
  )
}

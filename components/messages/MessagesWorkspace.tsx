'use client'

import { useEffect, useState } from 'react'
import UnifiedChat from '@/components/chat/UnifiedChat'
import AgentRunSession from '@/components/agents/AgentRunSession'

type MessagesSurface = 'admin' | 'portal'

interface MessagesWorkspaceProps {
  surface: MessagesSurface
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgSlug?: string
  orgName?: string
  userRole?: string
  initialConvId?: string
  initialAgentId?: string
  initialRunId?: string
  initialTaskId?: string
  initialTaskTitle?: string
}

const SURFACE_COPY: Record<MessagesSurface, {
  eyebrow: string
  title: string
  description: string
}> = {
  admin: {
    eyebrow: 'Workspace / Messages',
    title: 'Messages',
    description: 'Multi-participant conversations with your team and agents.',
  },
  portal: {
    eyebrow: 'Direct line to your team',
    title: 'Messages',
    description: 'Start a conversation with your team or the Partners in Biz team.',
  },
}

export function MessagesWorkspace({
  surface,
  orgId,
  currentUserUid,
  currentUserDisplayName,
  orgSlug,
  orgName,
  userRole,
  initialConvId,
  initialAgentId,
  initialRunId,
  initialTaskId,
  initialTaskTitle,
}: MessagesWorkspaceProps) {
  const [showIntro, setShowIntro] = useState(true)
  const copy = SURFACE_COPY[surface]
  const isAdmin = surface === 'admin'

  useEffect(() => {
    const timer = window.setTimeout(() => setShowIntro(false), 3000)
    return () => window.clearTimeout(timer)
  }, [])

  if (isAdmin && initialAgentId && initialRunId) {
    return (
      <AgentRunSession
        agentId={initialAgentId}
        runId={initialRunId}
        orgId={orgId}
        orgSlug={orgSlug ?? ''}
        currentUserUid={currentUserUid}
        currentUserDisplayName={currentUserDisplayName}
        taskId={initialTaskId}
        taskTitle={initialTaskTitle}
      />
    )
  }

  return (
    <div
      data-testid={`${surface}-messages-workspace`}
      className="flex min-h-[640px] h-[calc(100dvh-120px)] min-w-0 flex-col overflow-hidden"
    >
      <header
        data-testid={`${surface}-messages-intro`}
        className={[
          'hidden shrink-0 overflow-hidden transition-all duration-700 ease-out lg:flex lg:flex-wrap lg:items-end lg:justify-between lg:gap-4',
          showIntro ? 'mb-4 max-h-28 translate-y-0 opacity-100' : 'mb-0 max-h-0 -translate-y-2 opacity-0',
        ].join(' ')}
      >
        <div>
          <p className={isAdmin ? 'text-[10px] font-label uppercase tracking-widest text-on-surface-variant' : 'eyebrow'}>
            {copy.eyebrow}
          </p>
          <h1 className={isAdmin ? 'text-2xl font-headline font-bold text-on-surface mt-2' : 'pib-page-title mt-2'}>
            {copy.title}
          </h1>
          <p className={isAdmin ? 'text-sm text-on-surface-variant mt-1' : 'pib-page-sub mt-2 max-w-2xl'}>
            {copy.description}
          </p>
        </div>
      </header>

      <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <UnifiedChat
          orgId={orgId}
          currentUserUid={currentUserUid}
          currentUserDisplayName={currentUserDisplayName}
          orgName={orgName}
          initialConvId={initialConvId}
          allowDeleteConversations={isAdmin}
          allowAgentParticipants={isAdmin || userRole === 'admin'}
        />
      </section>
    </div>
  )
}

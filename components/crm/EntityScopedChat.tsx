'use client'

import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import UnifiedChat from '@/components/chat/UnifiedChat'
import { auth, getClientAuth } from '@/lib/firebase/config'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import { canRolePerformModuleAction } from '@/lib/organizations/module-policies'
import { Icon } from '@/components/studio'

type EntityScopedChatProps = {
  orgId: string
  orgName?: string
  entityType: 'company' | 'contact'
  entityId: string
  entityLabel: string
  href?: string
  summary?: string
  compact?: boolean
}

type ChatUser = {
  uid: string
  displayName: string
  role: string
  canStartConversations: boolean
  canUseAgentHandoff: boolean
}

export function EntityScopedChat({
  orgId,
  orgName,
  entityType,
  entityId,
  entityLabel,
  href,
  summary,
  compact = false,
}: EntityScopedChatProps) {
  const [user, setUser] = useState<ChatUser | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    getClientAuth()
      .authStateReady()
      .then(() => {
        if (cancelled) return
        unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
          if (!firebaseUser) {
            if (!cancelled) {
              setUser(null)
              setChecking(false)
            }
            return
          }

          fetch('/api/auth/verify')
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => {
              if (cancelled) return
              const displayName =
                body?.displayName ||
                body?.name ||
                firebaseUser.displayName ||
                firebaseUser.email?.split('@')[0] ||
                firebaseUser.uid
              const chatUser = {
                uid: firebaseUser.uid,
                displayName,
                role: body?.role || 'client',
              canStartConversations: body?.role === 'admin' || body?.role === 'ai',
              canUseAgentHandoff: body?.role === 'admin' || body?.role === 'ai',
              }
              if (chatUser.canUseAgentHandoff) {
                setUser(chatUser)
                setChecking(false)
                return
              }

              fetch(`/api/v1/portal/org?orgId=${encodeURIComponent(orgId)}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((portalBody) => {
                  if (cancelled) return
                  const policies = portalBody?.org?.modulePolicies
                  const memberRole = portalBody?.user?.memberRole ?? portalBody?.user?.role ?? 'viewer'
                  setUser({
                    ...chatUser,
                    canStartConversations: canRolePerformModuleAction(policies, 'messages', 'start', memberRole),
                    canUseAgentHandoff: canRolePerformModuleAction(policies, 'messages', 'agentHandoff', memberRole),
                  })
                  setChecking(false)
                })
                .catch(() => {
                  if (cancelled) return
                  setUser(chatUser)
                  setChecking(false)
                })
            })
            .catch(() => {
              if (cancelled) return
              setUser({
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || firebaseUser.uid,
                role: 'client',
                canStartConversations: false,
                canUseAgentHandoff: false,
              })
              setChecking(false)
            })
        })
      })
      .catch(() => {
        if (!cancelled) setChecking(false)
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const currentPageContext = useMemo<ContextReferenceSeed>(() => ({
    type: entityType,
    id: entityId,
    orgId,
    label: entityLabel,
    origin: 'current_page',
    ...(href ? { href } : {}),
    ...(summary ? { summary } : {}),
  }), [entityId, entityLabel, entityType, href, orgId, summary])

  if (checking) {
    return <div className="pib-skeleton h-[360px] w-full" aria-label={`${entityLabel} scoped chat loading`} />
  }

  if (!user) {
    return (
      <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3 text-xs text-[var(--color-pib-text-muted)]">
        Sign in to use the {entityType}-scoped chat for {entityLabel}.
      </div>
    )
  }

  const allowAgentParticipants = user.canUseAgentHandoff
  const isCompanyCowork = entityType === 'company'

  return (
    <section
      aria-label={`${entityLabel} ${entityType}-scoped chat`}
      className={[
        'flex flex-col overflow-hidden',
        compact
          ? 'min-h-[420px] rounded-md border border-[var(--color-card-border)]'
          : isCompanyCowork
            ? 'min-h-[560px] rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]/80'
            : 'min-h-[520px] overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45',
      ].join(' ')}
    >
      {isCompanyCowork && (
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-pib-line)] px-3.5 py-2.5">
          <span className="shrink-0" aria-hidden="true">
            <Icon name="folder" className="text-[16px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="pib-label text-[var(--color-pib-accent)]">Company Cowork</p>
            <h2 className="truncate text-sm font-medium leading-5 text-[var(--color-pib-text)]">
              {entityLabel}
            </h2>
          </div>
          <p className="hidden max-w-[14rem] text-right text-[11px] leading-4 text-[var(--color-pib-text-muted)] sm:block">
            Sessions stay on this folder. VPS by default - Mac anytime.
          </p>
        </header>
      )}
      <div className={isCompanyCowork ? 'min-h-0 flex-1' : 'contents'}>
        <UnifiedChat
          orgId={orgId}
          orgName={isCompanyCowork ? entityLabel : orgName}
          currentUserUid={user.uid}
          currentUserDisplayName={user.displayName}
          // Never includeAllScopes here: CRM contact/company embeds must only list
          // threads scoped to this entity (scope + scopeRefId). The Messages rail
          // is the place for the full conversation catalogue.
          scope={entityType}
          scopeRefId={entityId}
          initialAgentId={allowAgentParticipants ? 'pip' : undefined}
          autoCreateScopedConversation={user.canStartConversations && allowAgentParticipants}
          autoCreateTitle={isCompanyCowork ? `${entityLabel} Cowork` : `${entityLabel} ${entityType} workspace`}
          allowAgentParticipants={allowAgentParticipants}
          allowStartConversations={user.canStartConversations}
          currentPageContext={currentPageContext}
          compact={compact || isCompanyCowork}
        />
      </div>
    </section>
  )
}

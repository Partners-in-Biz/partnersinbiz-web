'use client'

import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import UnifiedChat from '@/components/chat/UnifiedChat'
import { auth, getClientAuth } from '@/lib/firebase/config'
import type { ContextReferenceSeed } from '@/lib/context-references/types'

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
              setUser({
                uid: firebaseUser.uid,
                displayName,
                role: body?.role || 'client',
              })
              setChecking(false)
            })
            .catch(() => {
              if (cancelled) return
              setUser({
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || firebaseUser.uid,
                role: 'client',
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
      <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-5 text-sm text-[var(--color-pib-text-muted)]">
        Sign in to use the {entityType}-scoped chat for {entityLabel}.
      </div>
    )
  }

  const allowAgentParticipants = user.role === 'admin' || user.role === 'ai'

  return (
    <section
      aria-label={`${entityLabel} ${entityType}-scoped chat`}
      className={compact ? 'min-h-[420px] overflow-hidden rounded-2xl border border-[var(--color-pib-line)]' : 'bento-card !p-0 min-h-[520px] overflow-hidden'}
    >
      <UnifiedChat
        orgId={orgId}
        orgName={orgName}
        currentUserUid={user.uid}
        currentUserDisplayName={user.displayName}
        scope={entityType}
        scopeRefId={entityId}
        initialAgentId={allowAgentParticipants ? 'pip' : undefined}
        autoCreateScopedConversation={allowAgentParticipants}
        autoCreateTitle={`${entityLabel} ${entityType} workspace`}
        allowAgentParticipants={allowAgentParticipants}
        currentPageContext={currentPageContext}
        compact={compact}
      />
    </section>
  )
}

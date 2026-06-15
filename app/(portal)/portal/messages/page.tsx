'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { useRouter, useSearchParams } from 'next/navigation'
import { auth, getClientAuth } from '@/lib/firebase/config'
import { MessagesWorkspace } from '@/components/messages/MessagesWorkspace'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'

interface OrgInfo {
  id: string
  name: string
}

interface UserInfo {
  uid: string
  name: string
  email: string
  role: string
  memberRole?: string | null
}

interface MessageCapabilities {
  canStart: boolean
  canReply: boolean
  canUseAgentHandoff: boolean
  canArchive: boolean
}

const DEFAULT_MESSAGE_CAPABILITIES: MessageCapabilities = {
  canStart: true,
  canReply: true,
  canUseAgentHandoff: true,
  canArchive: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function messageCapabilitiesFromPortalBody(body: Record<string, unknown>): MessageCapabilities {
  const org = isRecord(body.org) ? body.org : {}
  const user = isRecord(body.user) ? body.user : {}
  const policies = resolveOrganizationModulePolicies({ modulePolicies: org.modulePolicies })
  const role = user.memberRole ?? user.role
  return {
    canStart: canRolePerformModuleAction(policies, 'messages', 'start', role),
    canReply: canRolePerformModuleAction(policies, 'messages', 'reply', role),
    canUseAgentHandoff: canRolePerformModuleAction(policies, 'messages', 'agentHandoff', role),
    canArchive: canRolePerformModuleAction(policies, 'messages', 'archive', role),
  }
}

export default function PortalMessagesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgEndpoint = useMemo(() => scopedApiPath('/api/v1/portal/org', orgScope), [orgScope])
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [capabilities, setCapabilities] = useState<MessageCapabilities>(DEFAULT_MESSAGE_CAPABILITIES)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    getClientAuth()
      .authStateReady()
      .then(() => {
        if (cancelled) return
        unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
          if (!firebaseUser) {
            router.push('/login')
            return
          }

          fetch(orgEndpoint)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`org fetch: ${r.status}`))))
            .then((body) => {
              if (cancelled) return
              setOrg({ id: body.org.id, name: body.org.name })
              setCapabilities(messageCapabilitiesFromPortalBody(body))
              setUser({
                uid: firebaseUser.uid,
                name: body.user?.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || firebaseUser.uid,
                email: body.user?.email || firebaseUser.email || '',
                role: body.user?.role || 'client',
                memberRole: body.user?.memberRole ?? null,
              })
              setChecking(false)
            })
            .catch((e) => {
              if (cancelled) return
              setError(e instanceof Error ? e.message : 'Failed to load org')
              setChecking(false)
            })
        })
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [orgEndpoint, router])

  if (checking) {
    return (
      <div className="space-y-8">
        <div className="pib-skeleton h-8 w-48" />
        <div className="pib-skeleton h-[600px]" />
      </div>
    )
  }

  if (error || !org || !user) {
    return (
      <div className="space-y-8">
        <header>
          <p className="eyebrow">Messages</p>
          <h1 className="pib-page-title mt-2">Messages</h1>
        </header>
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">forum</span>
          <p className="text-[var(--color-pib-text-muted)] mt-4">
            {error ?? 'Could not load your workspace. Please try again.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <MessagesWorkspace
      surface="portal"
      orgId={org.id}
      orgName={org.name}
      currentUserUid={user.uid}
      currentUserDisplayName={user.name}
      userRole={user.role}
      allowStartConversations={capabilities.canStart}
      allowSendMessages={capabilities.canReply}
      allowAgentParticipants={capabilities.canUseAgentHandoff}
      allowArchiveConversations={capabilities.canArchive}
    />
  )
}

'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { auth, getClientAuth } from '@/lib/firebase/config'
import { MessagesWorkspace } from '@/components/messages/MessagesWorkspace'

interface OrgInfo {
  id: string
  name: string
}

interface UserInfo {
  uid: string
  name: string
  email: string
  role: string
}

export default function PortalMessagesPage() {
  const router = useRouter()
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
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

          fetch('/api/v1/portal/org')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`org fetch: ${r.status}`))))
            .then((body) => {
              if (cancelled) return
              setOrg({ id: body.org.id, name: body.org.name })
              setUser({
                uid: firebaseUser.uid,
                name: body.user?.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || firebaseUser.uid,
                email: body.user?.email || firebaseUser.email || '',
                role: body.user?.role || 'client',
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
  }, [router])

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
    />
  )
}

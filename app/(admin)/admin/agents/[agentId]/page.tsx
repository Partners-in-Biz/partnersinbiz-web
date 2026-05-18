'use client'
// app/(admin)/admin/agents/[agentId]/page.tsx
// Deep-link: renders AgentDetailPanel as a full page for a specific agent.
// Auth is handled by the parent (admin) layout.

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AgentDetailPanel } from '@/components/agents/AgentDetailPanel'
import type { AgentTeamDoc } from '@/components/agents/AgentCard'

interface SessionInfo {
  isSuperAdmin?: boolean
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function AgentDeepLinkPage() {
  const params    = useParams()
  const router    = useRouter()
  const agentId   = typeof params.agentId === 'string' ? params.agentId : ''

  const [agent, setAgent]     = useState<AgentTeamDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  useEffect(() => {
    if (!agentId) return
    fetch('/api/v1/admin/agents')
      .then((r) => r.json())
      .then((body) => {
        const all: AgentTeamDoc[] = body.data ?? []
        const found = all.find((a) => a.agentId === agentId) ?? null
        if (!found) {
          setError(`Agent "${agentId}" not found.`)
        } else {
          setAgent(found)
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load agent')
      })
      .finally(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((res) => (res.ok ? res.json() : null))
      .then((session: SessionInfo | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(session?.isSuperAdmin))
      })
      .catch(() => {
        if (!cancelled) setIsSuperAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSaved(updated: AgentTeamDoc) {
    setAgent(updated)
  }

  function handleClose() {
    router.push('/admin/agents')
  }

  return (
    <div className="max-w-xl mx-auto">
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : error ? (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      ) : (
        <div
          className="pib-card overflow-hidden"
          style={{ minHeight: '600px', display: 'flex', flexDirection: 'column' }}
        >
          <AgentDetailPanel
            agent={agent}
            onClose={handleClose}
            onSaved={handleSaved}
            canEdit={isSuperAdmin}
          />
        </div>
      )}
    </div>
  )
}

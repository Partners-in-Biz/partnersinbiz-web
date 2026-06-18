'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BriefingFeed, OrgSummary, Mode, Flash } from './cockpitTypes'

const BRIEFING_AUTO_REFRESH_MS = 5 * 60_000
const BRIEFING_CONTROL_DESK_LIMIT = '300'

export function useBriefingFeed(mode: Mode) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [orgId, setOrgId] = useState('')
  const [priority, setPriority] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [feed, setFeed] = useState<BriefingFeed | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (mode === 'portal') {
          const res = await fetch('/api/v1/portal/org')
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || 'Workspace lookup failed')
          const org = body.org
          if (cancelled) return
          if (org?.id) {
            setOrgId(org.id)
            setOrgs([{ id: org.id, name: org.name || 'Current workspace', slug: org.slug }])
          } else {
            setOrgs([])
          }
          return
        }

        const res = await fetch('/api/v1/organizations')
        const body = await res.json()
        const rows = (body.data ?? body.organizations ?? body.orgs ?? []) as OrgSummary[]
        if (cancelled) return
        setOrgs(rows)
      } catch {
        if (cancelled) return
        setOrgs([])
        if (mode === 'portal') setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mode])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (orgId) params.set('orgId', orgId)
    if (priority !== 'all') params.set('priority', priority)
    if (sourceType !== 'all') params.set('sourceType', sourceType)
    params.set('limit', BRIEFING_CONTROL_DESK_LIMIT)
    return params.toString()
  }, [orgId, priority, sourceType])

  const loadFeed = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (mode === 'portal' && !orgId) return
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/v1/briefings/feed?${query}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Briefing feed failed')
      const data = (body.data ?? body) as BriefingFeed
      setFeed(data)
      setSelectedId((current) => current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null)
      setFlash(null)
    } catch (err) {
      setFlash({ kind: 'error', message: err instanceof Error ? err.message : 'Briefing feed failed' })
      if (!quiet) setFeed({ items: [], total: 0, hasMore: false, generatedAt: new Date().toISOString() })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [mode, orgId, query])

  useEffect(() => {
    if (mode === 'portal' && !orgId) return
    loadFeed()
  }, [loadFeed, mode, orgId])

  useEffect(() => {
    if (!autoRefresh) return
    if (mode === 'portal' && !orgId) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadFeed({ quiet: true })
      }
    }, BRIEFING_AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadFeed, mode, orgId])

  return { orgs, orgId, setOrgId, priority, setPriority, sourceType, setSourceType, feed, setFeed, selectedId, setSelectedId, loading, autoRefresh, setAutoRefresh, flash, setFlash, loadFeed }
}

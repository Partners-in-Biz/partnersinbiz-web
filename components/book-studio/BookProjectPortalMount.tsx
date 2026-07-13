'use client'

import { useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { BookProjectWorkspace } from './BookProjectWorkspace'
import type { BookStudioCapabilities } from '@/lib/book-studio/capabilities'

type BookProjectPortalMountProps = {
  projectId: string
  orgId?: string | null
  initialTab?: 'content' | 'metadata' | 'assembly'
}

export function BookProjectPortalMount({ projectId, orgId, initialTab }: BookProjectPortalMountProps) {
  const [state, setState] = useState<{ capabilities: BookStudioCapabilities; orgId: string } | null>(null)
  const [notice, setNotice] = useState('')

  const apiPath = useMemo(() => scopedApiPath('/api/v1/portal/book-studio/projects', { orgId }), [orgId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(apiPath)
      const body = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) {
        setNotice(body.error ?? 'Book Studio is not available.')
        return
      }
      const data = body.data ?? body
      setState({ capabilities: data.capabilities, orgId: data.orgId ?? '' })
    }
    void load()
    return () => { cancelled = true }
  }, [apiPath])

  if (notice) return <main className="p-6 text-sm text-[var(--color-pib-text-muted)]">{notice}</main>
  if (!state) return <main className="p-6 text-sm text-[var(--color-pib-text-muted)]">Loading…</main>
  return <BookProjectWorkspace orgId={state.orgId} projectId={projectId} surface="portal" capabilities={state.capabilities} initialTab={initialTab} />
}

'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialLinksWorkspace from '@/components/social/SocialLinksWorkspace'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function LinksPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const buildApiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return <SocialLinksWorkspace buildApiPath={buildApiPath} />
}

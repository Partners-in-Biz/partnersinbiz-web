'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BrandProfileEditor,
  type BrandAssetUploadPayload,
  type BrandColors,
  type BrandProfile,
  type BrandProfileSavePayload,
  type BrandWorkspaceOrg,
} from '@/components/brand/BrandProfileEditor'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

interface PortalBrandResponse {
  success?: boolean
  error?: string
  data?: {
    org: BrandWorkspaceOrg
    brandProfile?: BrandProfile
    brandColors?: BrandColors
  }
}

interface BrandProfilePageData {
  org: BrandWorkspaceOrg
  brandProfile?: BrandProfile
  brandColors?: BrandColors
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function BrandingPage() {
  const searchParams = useSearchParams()
  const orgScope = scopeFromSearchParams(searchParams)
  const brandProfileEndpoint = scopedApiPath('/api/v1/portal/brand-profile', orgScope)
  const brandAssetUploadEndpoint = scopedApiPath('/api/v1/portal/brand-profile/upload', orgScope)
  const [pageData, setPageData] = useState<BrandProfilePageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError('')
        const res = await fetch(brandProfileEndpoint)
        const body = (await res.json().catch(() => ({}))) as PortalBrandResponse
        if (!res.ok || !body.data) throw new Error(body.error ?? 'Failed to load brand profile')
        if (!cancelled) setPageData(body.data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load brand profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [brandProfileEndpoint])

  async function saveBrandProfile({ brandProfile, brandColors }: BrandProfileSavePayload) {
    const res = await fetch(brandProfileEndpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandProfile, brandColors }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to save brand profile')
  }

  async function uploadBrandAsset({ file, folder }: BrandAssetUploadPayload) {
    const form = new FormData()
    form.append('file', file)
    form.append('folder', folder)

    const res = await fetch(brandAssetUploadEndpoint, { method: 'POST', body: form })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.data?.url) throw new Error(body.error ?? 'Upload failed')
    return body.data.url as string
  }

  if (loading) {
    return (
      <div className="max-w-4xl space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (error || !pageData) {
    return (
      <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
        {error || 'Brand profile unavailable'}
      </div>
    )
  }

  return (
    <BrandProfileEditor
      org={pageData.org}
      brandProfile={pageData.brandProfile}
      brandColors={pageData.brandColors}
      onSave={saveBrandProfile}
      onUpload={uploadBrandAsset}
    />
  )
}

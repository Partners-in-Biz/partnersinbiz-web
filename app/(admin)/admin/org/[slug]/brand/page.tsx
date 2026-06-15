'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  BrandProfileEditor,
  type BrandAssetUploadPayload,
  type BrandColors,
  type BrandProfile,
  type BrandProfileSavePayload,
  type BrandWorkspaceOrg,
} from '@/components/brand/BrandProfileEditor'

export const dynamic = 'force-dynamic'

interface OrganizationSummary extends BrandWorkspaceOrg {
  brandProfile?: BrandProfile
}

interface OrganizationDetail extends BrandWorkspaceOrg {
  brandProfile?: BrandProfile
  settings?: {
    brandColors?: BrandColors
  }
}

interface BrandPageData {
  org: BrandWorkspaceOrg
  brandProfile?: BrandProfile
  brandColors?: BrandColors
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function BrandPage() {
  const params = useParams()
  const slug = params.slug as string
  const [pageData, setPageData] = useState<BrandPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!slug) return

      try {
        setLoading(true)
        setError('')

        const listRes = await fetch('/api/v1/organizations')
        const listBody = await listRes.json().catch(() => ({}))
        if (!listRes.ok) throw new Error(listBody.error ?? 'Failed to fetch organizations')

        const summary = ((listBody.data ?? []) as OrganizationSummary[]).find((org) => org.slug === slug)
        if (!summary) throw new Error('Organization not found')

        const detailRes = await fetch(`/api/v1/organizations/${summary.id}`, { headers: { 'X-Org-Id': summary.id, 'X-Org-Slug': slug } })
        const detailBody = await detailRes.json().catch(() => ({}))
        if (!detailRes.ok || !detailBody.data) {
          throw new Error(detailBody.error ?? 'Failed to fetch organization details')
        }

        const detail = detailBody.data as OrganizationDetail
        if (!cancelled) {
          setPageData({
            org: { id: detail.id, name: detail.name, slug: detail.slug },
            brandProfile: detail.brandProfile,
            brandColors: detail.settings?.brandColors,
          })
        }
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
  }, [slug])

  async function saveBrandProfile({ brandProfile, brandColors }: BrandProfileSavePayload) {
    if (!pageData) throw new Error('Organization not found')

    const res = await fetch(`/api/v1/organizations/${pageData.org.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': pageData.org.id, 'X-Org-Slug': slug },
      body: JSON.stringify({ brandProfile, settings: { brandColors } }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to save brand profile')
  }

  async function uploadBrandAsset({ file, folder }: BrandAssetUploadPayload) {
    if (!pageData) throw new Error('Organization not found')

    const form = new FormData()
    form.append('file', file)
    form.append('folder', folder)
    form.append('orgId', pageData.org.id)
    form.append('relatedToType', 'organization')
    form.append('relatedToId', pageData.org.id)

    const res = await fetch('/api/v1/upload', { method: 'POST', headers: { 'X-Org-Id': pageData.org.id, 'X-Org-Slug': slug }, body: form })
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
      description={`Everything Partners in Biz agents and designers need to produce on-brand work for ${pageData.org.name}.`}
      onSave={saveBrandProfile}
      onUpload={uploadBrandAsset}
    />
  )
}

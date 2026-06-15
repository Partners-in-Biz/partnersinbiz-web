'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AssetGrid } from '@/components/campaign-cockpit/AssetGrid'
import { OrgThemedFrame, useOrgBrand } from '@/components/admin/OrgThemedFrame'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PostRow = any

export default function StandaloneSocialPage() {
  const params = useParams()
  const slug = params?.slug as string
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string>('')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const org = (body.data ?? []).find((o: any) => o.slug === slug)
        if (org) {
          setOrgId(org.id)
          setOrgName(org.name)
        }
      })
      .catch(() => {})
  }, [slug])

  return (
    <OrgThemedFrame orgId={orgId} className="-m-6 p-6 min-h-screen">
      <Standalone slug={slug} orgId={orgId} orgName={orgName} />
    </OrgThemedFrame>
  )
}

function Standalone({
  slug,
  orgId,
  orgName,
}: {
  slug: string
  orgId: string | null
  orgName: string
}) {
  const { brand } = useOrgBrand()
  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    fetch(`/api/v1/social/posts?orgId=${encodeURIComponent(orgId)}&limit=500`)
      .then(r => r.json())
      .then(body => {
        const all = (body.data ?? []) as PostRow[]
        setPosts(all.filter(p => !p.campaignId))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  return (
    <div className="space-y-8 max-w-7xl mx-auto" style={{ color: 'var(--org-text, var(--color-pib-text))' }}>
      <header className="space-y-2">
        <Link
          href={`/admin/org/${slug}/social`}
          className="text-xs text-on-surface-variant hover:text-on-surface inline-flex items-center gap-1"
        >
          ← Back to {orgName || 'social'}
        </Link>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          Standalone · Not part of a campaign
        </p>
        <h1 className="text-3xl md:text-4xl font-headline font-bold">
          Standalone Posts
        </h1>
        <p className="text-sm text-on-surface-variant">
          Posts composed manually for {orgName || 'this client'}, outside of any
          content-engine campaign.
        </p>
      </header>

      <AdminOperatorGate
        title="Standalone social publishing is approval-gated"
        body="Standalone posts can be reviewed here by PiB operators, but approve, schedule, and publish controls stay locked until a Projects/Kanban approval gate is recorded."
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="pib-skeleton h-80 rounded-2xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="pib-card py-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No standalone posts. Compose one to get started.
          </p>
        </div>
      ) : (
        <AssetGrid
          campaignId="standalone"
          brand={brand}
          social={posts}
          blogs={[]}
          videos={[]}
          filter="social"
          readonly
        />
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AssetGrid } from '@/components/campaign-cockpit/AssetGrid'
import {
  OrgPreviewBrandScope,
  OrgThemedFrame,
  useOrgBrand,
} from '@/components/admin/OrgThemedFrame'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { Skeleton } from '@/components/studio'

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
    <OrgThemedFrame orgId={orgId}>
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
  const { brand, brandColors } = useOrgBrand()
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
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href={`/admin/org/${slug}/social`}
          className="sc-tiny text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] inline-flex items-center gap-1"
        >
          Back to {orgName || 'social'}
        </Link>
        <PageHeader
          eyebrow="Standalone"
          title="Standalone posts."
          description={`Posts composed manually for ${orgName || 'this client'}, outside of any content-engine campaign.`}
        />
      </div>

      <AdminOperatorGate
        title="Standalone social publishing is approval-gated"
        body="Standalone posts can be reviewed here by PiB operators, but approve, schedule, and publish controls stay locked until a Projects/Kanban approval gate is recorded."
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          title="No standalone posts."
          description="Compose one to get started."
        />
      ) : (
        <OrgPreviewBrandScope brandColors={brandColors}>
          <AssetGrid
            campaignId="standalone"
            brand={brand}
            social={posts}
            blogs={[]}
            videos={[]}
            filter="social"
            readonly
          />
        </OrgPreviewBrandScope>
      )}
    </div>
  )
}

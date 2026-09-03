'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import BroadcastEditor from '@/components/admin/broadcasts/BroadcastEditor'
import { EmptyState } from '@/components/ui/AppFoundation'
import { Skeleton } from '@/components/studio'
import type { Broadcast } from '@/lib/broadcasts/types'

export default function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [id, setId] = useState<string | null>(null)
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    params.then((p) => {
      setId(p.id)
      fetch(`/api/v1/broadcasts/${p.id}`)
        .then((r) => r.json())
        .then((b) => setBroadcast(b.data ?? null))
        .finally(() => setLoading(false))
    })
  }, [params])

  if (loading) return <Skeleton height={160} />
  if (!broadcast || !id) {
    return <EmptyState title="Broadcast not found." />
  }

  return (
    <BroadcastEditor
      id={id}
      initial={broadcast}
      onBack={() => router.push('/portal/broadcasts')}
      onDeleted={() => router.push('/portal/broadcasts')}
    />
  )
}

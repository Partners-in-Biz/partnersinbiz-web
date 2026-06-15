'use client'
import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function AgentRedirect() {
  const router = useRouter()
  const params = useParams()
  const slug = params?.slug as string
  useEffect(() => {
    if (slug) router.replace(`/admin/org/${slug}/agent/board`)
  }, [slug, router])
  return <div className="p-8 text-[var(--color-pib-text-muted)]">Redirecting to Agent Board…</div>
}

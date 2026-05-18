// app/(admin)/admin/org/[slug]/ads/experiments/new/page.tsx
// Sub-5 Batch 2B — Create experiment page
'use client'

import { useParams, useRouter } from 'next/navigation'
import { ExperimentEditor } from '@/components/ads/ExperimentEditor'
import type { AdExperiment } from '@/lib/ads/experiments/types'
import Link from 'next/link'

export default function NewExperimentPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const router = useRouter()

  function handleSaved(experiment: AdExperiment) {
    router.push(`/admin/org/${slug}/ads/experiments/${experiment.id}`)
  }

  return (
    <section className="max-w-2xl space-y-4">
      <header>
        <Link
          href={`/admin/org/${slug}/ads/experiments`}
          className="text-xs text-white/40 hover:text-white/60"
        >
          ← Experiments
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">New experiment</h1>
      </header>
      <div className="rounded-lg border border-white/10 p-5">
        <ExperimentEditor orgSlug={slug} onSaved={handleSaved} />
      </div>
    </section>
  )
}

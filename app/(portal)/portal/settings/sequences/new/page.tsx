'use client'
export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import type { Sequence } from '@/lib/sequences/types'

export default function NewSequencePage() {
  const router = useRouter()

  function handleSave(_seq: Sequence) {
    router.push('/portal/settings/sequences')
  }

  function handleCancel() {
    router.push('/portal/settings/sequences')
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <button
          type="button"
          onClick={handleCancel}
          className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Sequences
        </button>
        <h1 className="text-lg font-semibold">New Sequence</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
          Build a multi-step email or SMS drip campaign.
        </p>
      </div>

      <SequenceForm onSave={handleSave} onCancel={handleCancel} />
    </div>
  )
}

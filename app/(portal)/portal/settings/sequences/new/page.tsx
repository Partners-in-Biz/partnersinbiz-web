'use client'
export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'

export default function NewSequencePage() {
  const router = useRouter()

  function handleSave() {
    router.push('/portal/settings/sequences')
  }

  function handleCancel() {
    router.push('/portal/settings/sequences')
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Sequences
          </button>
          <p className="eyebrow !text-[10px]">Journey builder</p>
          <h1 className="pib-page-title mt-2">New sequence</h1>
          <p className="pib-page-sub max-w-2xl">
            Build a CRM follow-up path with clear timing, channel choices, and launch readiness before contacts enter it.
          </p>
        </div>
        <div className="bento-card !p-4 w-full max-w-sm">
          <p className="text-xs font-medium">Recommended starting point</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Keep the first journey short: one immediate confirmation, one value follow-up, and one human handoff.
          </p>
        </div>
      </div>

      <SequenceForm onSave={handleSave} onCancel={handleCancel} />
    </div>
  )
}

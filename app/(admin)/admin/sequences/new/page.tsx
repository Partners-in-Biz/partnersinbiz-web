'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import { useOrg } from '@/lib/contexts/OrgContext'
import { appendQueryParams } from '@/lib/portal/scoped-routing'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export default function NewSequencePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const { selectedOrgId, orgs } = useOrg()

  const orgScope = useMemo(() => {
    const params = new URLSearchParams(search)
    const requestedSlug = params.get('org')?.trim() || params.get('orgSlug')?.trim() || ''
    const requestedOrgId = params.get('orgId')?.trim() || ''
    const selectedOrg = orgs.find((org) => org.id === selectedOrgId)
    const requestedOrg = orgs.find((org) => {
      if (requestedOrgId && org.id === requestedOrgId) return true
      if (requestedSlug && org.slug === requestedSlug) return true
      if (requestedSlug && org.id === requestedSlug) return true
      return false
    })

    return {
      orgId: requestedOrg?.id || requestedOrgId || selectedOrgId || PIB_PLATFORM_ORG_ID,
      orgSlug: requestedOrg?.slug || requestedSlug || selectedOrg?.slug || undefined,
    }
  }, [orgs, search, selectedOrgId])

  const sequencesHref = useMemo(
    () => appendQueryParams('/admin/sequences', {
      orgId: orgScope.orgId,
      orgSlug: orgScope.orgSlug,
      org: orgScope.orgSlug,
    }),
    [orgScope],
  )

  function handleSave() {
    router.push(sequencesHref)
  }

  function handleCancel() {
    router.push(sequencesHref)
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer mb-4 flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Sequences
          </button>
          <p className="eyebrow !text-[10px]">Journey builder</p>
          <h1 className="pib-page-title mt-2">New sequence</h1>
          <p className="pib-page-sub max-w-2xl">
            Build a CRM follow-up path for this company with clear timing, channel choices, and launch readiness.
          </p>
        </div>
        <div className="bento-card !p-4 w-full max-w-sm">
          <p className="text-xs font-medium">Company-scoped journey</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            This sequence is created against the organisation selected from the company workspace.
          </p>
        </div>
      </div>

      <SequenceForm
        apiScope={orgScope}
        initial={{ orgId: orgScope.orgId ?? undefined }}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  )
}

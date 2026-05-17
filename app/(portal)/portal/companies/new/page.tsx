'use client'
export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import { CompanyEditDrawer } from '@/components/crm/CompanyEditDrawer'

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewCompanyPage() {
  const router = useRouter()

  async function handleSave(data: Partial<Company>): Promise<void> {
    const res = await fetch('/api/v1/crm/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to create company')
    }
    const body = await res.json()
    const newId: string | undefined = body.data?.id ?? body.id
    if (newId) {
      router.push(`/portal/companies/${newId}`)
    } else {
      router.push('/portal/companies')
    }
  }

  function handleClose() {
    router.push('/portal/companies')
  }

  return (
    <>
      {/* Breadcrumb (visible behind the drawer) */}
      <div className="space-y-4 p-4">
        <Link
          href="/portal/companies"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Companies
        </Link>
      </div>

      {/* Drawer is always open on this route */}
      <CompanyEditDrawer
        mode="create"
        onSave={handleSave}
        onClose={handleClose}
      />
    </>
  )
}

'use client'
export const dynamic = 'force-dynamic'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import { CompanyEditDrawer, type CompanyTeamMember } from '@/components/crm/CompanyEditDrawer'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewCompanyPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const companyApiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
  const companyPortalPath = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])
  const [teamMembers, setTeamMembers] = useState<CompanyTeamMember[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(companyApiPath('/api/v1/portal/settings/team'))
      .then((res) => res.ok ? res.json() : null)
      .then((body) => {
        if (cancelled) return
        const members = Array.isArray(body?.members) ? body.members : []
        setTeamMembers(members.filter((member: CompanyTeamMember) => member.uid))
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([])
      })
    return () => { cancelled = true }
  }, [companyApiPath])

  async function handleSave(data: Partial<Company>): Promise<void> {
    const res = await fetch(companyApiPath('/api/v1/crm/companies'), {
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
      router.push(companyPortalPath(`/portal/companies/${newId}`))
    } else {
      router.push(companyPortalPath('/portal/companies'))
    }
  }

  function handleClose() {
    router.push(companyPortalPath('/portal/companies'))
  }

  return (
    <>
      {/* Setup context visible behind the drawer */}
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6 lg:pr-[min(34rem,45vw)]">
        <Link
          href={companyPortalPath('/portal/companies')}
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Companies
        </Link>

        <section className="max-w-3xl">
          <p className="eyebrow">CRM account setup</p>
          <h1 className="pib-page-title mt-2">Create a company command center</h1>
          <p className="pib-page-sub mt-2">
            Capture the business profile once, then connect contacts, deals, proposals, invoices, projects, service workspaces, and activity around the account.
          </p>
        </section>

        <section className="grid max-w-5xl gap-3 md:grid-cols-3">
          {[
            { icon: 'domain', title: 'Identity', copy: 'Name, domain, industry, tier, lifecycle, and brand signal.' },
            { icon: 'receipt_long', title: 'Billing readiness', copy: 'Legal details, VAT, accounts contact, signatory, PO rules, and invoice notes.' },
            { icon: 'hub', title: 'Relationship graph', copy: 'Owner, parent account, client org link, contacts, deals, and delivery history.' },
          ].map((item) => (
            <div key={item.title} className="pib-card p-4">
              <span className="material-symbols-outlined text-[22px] text-[var(--color-pib-text-muted)]">{item.icon}</span>
              <h2 className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">{item.title}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
            </div>
          ))}
        </section>

        <section className="max-w-5xl rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow !text-[10px]">After save</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">You will land on the company detail workspace to add contacts, deals, documents, analytics, and activity.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--color-pib-text-muted)]">
              <span className="rounded-full bg-white/5 px-2.5 py-1">Create</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1">Edit</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1">Archive</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1">Analyze</span>
            </div>
          </div>
        </section>
      </div>

      {/* Drawer is always open on this route */}
      <CompanyEditDrawer
        mode="create"
        orgScope={orgScope}
        onSave={handleSave}
        onClose={handleClose}
        teamMembers={teamMembers}
      />
    </>
  )
}

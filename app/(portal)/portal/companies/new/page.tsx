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
      <div className="mx-auto flex max-w-7xl flex-col gap-2 p-4 lg:pr-[min(34rem,45vw)]">
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55">
          <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-[var(--color-card-border)] px-3 py-1.5">
            <Link
              href={companyPortalPath('/portal/companies')}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition-colors hover:bg-white/[0.05] hover:text-on-surface"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_back</span>
              Companies
            </Link>
            <div className="min-w-0">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">CRM account setup</p>
              <h1 className="truncate text-sm font-semibold text-on-surface">Create a company command center</h1>
            </div>
          </div>
          <p className="px-3 py-2 text-xs leading-5 text-on-surface-variant">
            Capture the business profile once, then connect contacts, deals, proposals, invoices, projects, service workspaces, and activity around the account.
          </p>
        </div>

        <section className="grid gap-2 md:grid-cols-3">
          {[
            { icon: 'domain', title: 'Identity', copy: 'Name, domain, industry, tier, lifecycle, and brand signal.' },
            { icon: 'receipt_long', title: 'Billing readiness', copy: 'Legal details, VAT, accounts contact, signatory, PO rules, and invoice notes.' },
            { icon: 'hub', title: 'Relationship graph', copy: 'Owner, parent account, client org link, contacts, deals, and delivery history.' },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-2.5 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-2.5">
              <span className="material-symbols-outlined mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[16px] text-primary">{item.icon}</span>
              <div className="min-w-0">
                <h2 className="text-xs font-semibold text-on-surface">{item.title}</h2>
                <p className="mt-0.5 text-[11px] leading-4 text-on-surface-variant">{item.copy}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">After save</p>
              <p className="mt-0.5 text-xs text-on-surface">You will land on the company detail workspace to add contacts, deals, documents, analytics, and activity.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-on-surface-variant">
              <span className="flex h-7 items-center rounded-full border border-[var(--color-card-border)] px-2.5">Create</span>
              <span className="flex h-7 items-center rounded-full border border-[var(--color-card-border)] px-2.5">Edit</span>
              <span className="flex h-7 items-center rounded-full border border-[var(--color-card-border)] px-2.5">Archive</span>
              <span className="flex h-7 items-center rounded-full border border-[var(--color-card-border)] px-2.5">Analyze</span>
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

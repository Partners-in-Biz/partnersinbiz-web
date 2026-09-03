'use client'
export const dynamic = 'force-dynamic'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import { CompanyEditDrawer, type CompanyTeamMember } from '@/components/crm/CompanyEditDrawer'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

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
      <div className="mx-auto flex max-w-7xl flex-col space-y-8 p-4 lg:pr-[min(34rem,45vw)]">
        <header>
          <Link
            href={companyPortalPath('/portal/companies')}
            className="btn-pib-ghost text-xs"
          >
            <Icon name="arrow_back" />
            Companies
          </Link>
          <p className="eyebrow mt-4">CRM account setup</p>
          <h1 className="pib-page-title mt-2">Create a company command center</h1>
          <p className="pib-page-sub">
            Capture the business profile once, then connect contacts, deals, proposals, invoices, projects, service workspaces, and activity around the account.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { icon: 'domain', title: 'Identity', copy: 'Name, domain, industry, tier, lifecycle, and brand signal.' },
            { icon: 'receipt_long', title: 'Billing readiness', copy: 'Legal details, VAT, accounts contact, signatory, PO rules, and invoice notes.' },
            { icon: 'hub', title: 'Relationship graph', copy: 'Owner, parent account, client org link, contacts, deals, and delivery history.' },
          ].map((item) => (
            <div key={item.title} className="pib-card flex items-start gap-3">
              <Icon name={item.icon} />
              <div className="min-w-0">
                <h2 className="text-sm text-[var(--color-pib-text)]">{item.title}</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="pib-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="pib-label mb-0">After save</p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">You will land on the company detail workspace to add contacts, deals, documents, analytics, and activity.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="pib-pill">Create</span>
              <span className="pib-pill">Edit</span>
              <span className="pib-pill">Archive</span>
              <span className="pib-pill">Analyze</span>
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

'use client'

import { Icon } from '@/components/studio'

import { useEffect, useMemo, useState } from 'react'

type AccessMember = {
  id?: string
  uid?: string
  displayName?: string
  email?: string
  role?: string
  status?: string
  memberType?: string
}

type AccessOrganization = {
  id?: string
  orgId?: string
  companyId?: string
  recipientCompanyName?: string
  recipientEmail?: string
  role?: string
  status?: string
}

type AccessInvite = {
  id?: string
  recipientEmail?: string
  recipientName?: string
  recipientCompanyName?: string
  status?: string
  role?: string
}

type CrmCompany = {
  id: string
  name?: string
  email?: string
  linkedOrgId?: string
}

type CrmContact = {
  id: string
  name?: string
  email?: string
  linkedUserId?: string
}

type AccessibleOrganization = {
  id: string
  name: string
}

interface AccessData {
  members: AccessMember[]
  memberCandidates: AccessMember[]
  organizations: AccessOrganization[]
  invites: AccessInvite[]
}

const ROLE_OPTIONS = ['manager', 'contributor', 'reviewer', 'viewer'] as const

function labelForMember(member: AccessMember): string {
  return member.displayName || member.email || member.uid || 'Unknown member'
}

function labelForOrganization(org: AccessOrganization): string {
  return org.recipientCompanyName || org.recipientEmail || org.orgId || org.companyId || 'External organisation'
}

function scopedUrl(path: string, orgId?: string): string {
  return orgId ? `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(orgId)}` : path
}

function StatusPill({ value }: { value?: string }) {
  return (
    <span className="pib-pill pib-pill-cyan">
      {value || 'active'}
    </span>
  )
}

export function ProjectPeopleAccessPanel({ projectId, orgId }: { projectId: string; orgId?: string }) {
  const [data, setData] = useState<AccessData>({ members: [], memberCandidates: [], organizations: [], invites: [] })
  const [loading, setLoading] = useState(true)
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedMember, setSelectedMember] = useState<AccessMember | null>(null)
  const [memberRole, setMemberRole] = useState('contributor')
  const [companyId, setCompanyId] = useState('')
  const [contactId, setContactId] = useState('')
  const [companySearch, setCompanySearch] = useState('')
  const [companyResults, setCompanyResults] = useState<CrmCompany[]>([])
  const [companySearchLoading, setCompanySearchLoading] = useState(false)
  const [companyCreating, setCompanyCreating] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<CrmCompany | null>(null)
  const [contactResults, setContactResults] = useState<CrmContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null)
  const [newContactName, setNewContactName] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [contactCreating, setContactCreating] = useState(false)
  const [orgRole, setOrgRole] = useState('reviewer')
  const [accessibleOrganizations, setAccessibleOrganizations] = useState<AccessibleOrganization[]>([])
  const [accessibleOrganizationsLoading, setAccessibleOrganizationsLoading] = useState(true)
  const [targetOrgId, setTargetOrgId] = useState('')
  const [targetOrgRole, setTargetOrgRole] = useState('reviewer')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const auditRows = useMemo(
    () => [
      ...data.members.map((item) => ({ id: item.id || item.uid || labelForMember(item), label: labelForMember(item), kind: 'Member', status: item.status, role: item.role })),
      ...data.organizations.map((item) => ({ id: item.id || item.orgId || labelForOrganization(item), label: labelForOrganization(item), kind: 'Organisation', status: item.status, role: item.role })),
      ...data.invites.map((item) => ({ id: item.id || item.recipientEmail || item.recipientName || 'invite', label: item.recipientEmail || item.recipientName || item.recipientCompanyName || 'Pending invite', kind: 'Invite', status: item.status, role: item.role })),
    ],
    [data],
  )
  const currentProjectMemberIds = useMemo(
    () => new Set(data.members.map((member) => member.uid).filter(Boolean)),
    [data.members],
  )
  const memberMatches = useMemo(() => {
    const query = memberSearch.trim().toLowerCase()
    if (query.length < 2) return []
    return data.memberCandidates
      .filter((member) => member.uid && !currentProjectMemberIds.has(member.uid))
      .filter((member) => {
        const label = labelForMember(member).toLowerCase()
        const email = (member.email || '').toLowerCase()
        return label.includes(query) || email.includes(query)
      })
      .slice(0, 8)
  }, [currentProjectMemberIds, data.memberCandidates, memberSearch])
  const linkedOrganizationIds = useMemo(
    () => new Set(data.organizations
      .filter((organization) => organization.status !== 'pending' && organization.status !== 'revoked')
      .map((organization) => organization.orgId)
      .filter((id): id is string => Boolean(id))),
    [data.organizations],
  )
  const organizationOptions = useMemo(
    () => accessibleOrganizations.filter((organization) => (
      organization.id !== orgId && !linkedOrganizationIds.has(organization.id)
    )),
    [accessibleOrganizations, linkedOrganizationIds, orgId],
  )

  async function loadAccess() {
    setLoading(true)
    try {
      const res = await fetch(scopedUrl(`/api/v1/projects/${projectId}/access`, orgId))
      const body = await res.json().catch(() => ({}))
      const next = body.data ?? {}
      setData({
        members: Array.isArray(next.members) ? next.members : [],
        memberCandidates: Array.isArray(next.memberCandidates) ? next.memberCandidates : [],
        organizations: Array.isArray(next.organizations) ? next.organizations : [],
        invites: Array.isArray(next.invites) ? next.invites : [],
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project access')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccess().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, projectId])

  useEffect(() => {
    let cancelled = false
    setAccessibleOrganizationsLoading(true)
    fetch('/api/v1/organizations')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Failed to load organisations')
        if (cancelled) return
        const organizations = Array.isArray(body.data) ? body.data : []
        setAccessibleOrganizations(organizations.flatMap((value: unknown) => {
          if (!value || typeof value !== 'object') return []
          const row = value as Record<string, unknown>
          const id = typeof row.id === 'string' ? row.id.trim() : ''
          const name = typeof row.name === 'string' ? row.name.trim() : ''
          return id ? [{ id, name: name || id }] : []
        }))
      })
      .catch(() => {
        if (!cancelled) setAccessibleOrganizations([])
      })
      .finally(() => {
        if (!cancelled) setAccessibleOrganizationsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const query = companySearch.trim()
    if (query.length < 2) {
      setCompanyResults([])
      setCompanySearchLoading(false)
      return
    }

    let cancelled = false
    setCompanySearchLoading(true)
    fetch(scopedUrl(`/api/v1/crm/companies?search=${encodeURIComponent(query)}&limit=8`, orgId))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        const companies = body.data?.companies
        if (!cancelled) setCompanyResults(Array.isArray(companies) ? companies : [])
      })
      .catch(() => {
        if (!cancelled) setCompanyResults([])
      })
      .finally(() => {
        if (!cancelled) setCompanySearchLoading(false)
      })
    return () => { cancelled = true }
  }, [companySearch, orgId])

  useEffect(() => {
    if (!selectedCompany?.id) {
      setContactResults([])
      setContactsLoading(false)
      return
    }

    let cancelled = false
    setContactsLoading(true)
    fetch(scopedUrl(`/api/v1/crm/companies/${selectedCompany.id}/contacts?limit=20`, orgId))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        const contacts = body.data?.contacts
        if (!cancelled) setContactResults(Array.isArray(contacts) ? contacts : [])
      })
      .catch(() => {
        if (!cancelled) setContactResults([])
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false)
      })
    return () => { cancelled = true }
  }, [orgId, selectedCompany])

  async function postAccess(payload: Record<string, unknown>): Promise<boolean> {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(scopedUrl(`/api/v1/projects/${projectId}/access`, orgId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...(orgId ? { orgId } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Project access update failed')
      await loadAccess()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project access update failed')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function createCrmCompany() {
    const name = companySearch.trim()
    if (!name) return
    setCompanyCreating(true)
    setError(null)
    try {
      const res = await fetch(scopedUrl('/api/v1/crm/companies', orgId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'CRM company creation failed')
      const company = body.data?.company ?? body.data ?? {}
      const nextCompany: CrmCompany = {
        id: String(company.id || ''),
        name: String(company.name || name),
        email: typeof company.email === 'string' ? company.email : undefined,
        linkedOrgId: typeof company.linkedOrgId === 'string' ? company.linkedOrgId : undefined,
      }
      if (!nextCompany.id) throw new Error('CRM company creation did not return an id')
      setSelectedCompany(nextCompany)
      setCompanyId(nextCompany.id)
      setCompanySearch(nextCompany.name || name)
      setCompanyResults([])
      setSelectedContact(null)
      setContactId('')
      setContactResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CRM company creation failed')
    } finally {
      setCompanyCreating(false)
    }
  }

  async function createCrmContact() {
    const name = newContactName.trim()
    const email = newContactEmail.trim()
    if (!selectedCompany?.id || !name || !email) return
    setContactCreating(true)
    setError(null)
    try {
      const payload = {
        name,
        email,
        companyId: selectedCompany.id,
        company: selectedCompany.name || '',
        source: 'manual',
        type: 'prospect',
        stage: 'new',
      }
      const res = await fetch(scopedUrl('/api/v1/crm/contacts', orgId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'CRM contact creation failed')
      const id = String(body.data?.id || '')
      if (!id) throw new Error('CRM contact creation did not return an id')
      const nextContact = { id, name, email }
      setContactResults((current) => [nextContact, ...current.filter((contact) => contact.id !== id)])
      setSelectedContact(nextContact)
      setContactId(id)
      setNewContactName('')
      setNewContactEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CRM contact creation failed')
    } finally {
      setContactCreating(false)
    }
  }

  return (
    <section className="pib-card">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="pib-label">People & Access</p>
          <h2 className="mt-1 text-xl font-headline font-medium text-[var(--color-pib-text)]">Project collaboration</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">Invite people and organisations to this project without granting workspace-wide access.</p>
        </div>
        <button type="button" onClick={() => loadAccess()} className="pib-btn-secondary text-xs font-label" disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
          <h3 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">Internal members</h3>
          <div className="mt-3 space-y-2">
            {data.members.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">{loading ? 'Loading members...' : 'No project members yet.'}</p> : null}
            {data.members.map((member) => (
              <div key={member.id || member.uid} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{labelForMember(member)}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{member.memberType || 'internal'} / {member.role || 'viewer'}</p>
                </div>
                <StatusPill value={member.status} />
              </div>
            ))}
          </div>
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!selectedMember?.uid) return
              postAccess({ action: 'add_member', uid: selectedMember.uid, role: memberRole }).then(() => {
                setMemberSearch('')
                setSelectedMember(null)
              })
            }}
          >
            <div className="min-w-[220px] flex-1">
              <label>
                <span className="pib-label mb-1 block">Search team member</span>
                <input
                  value={memberSearch}
                  onChange={(event) => {
                    setMemberSearch(event.target.value)
                    setSelectedMember(null)
                  }}
                  placeholder="Search owner-org members by name or email"
                  className="pib-input"
                />
              </label>
              {selectedMember ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-xs text-[var(--color-pib-text)]">
                  <span className="min-w-0 truncate">Selected member: {labelForMember(selectedMember)}</span>
                  <button type="button" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]" onClick={() => setSelectedMember(null)} aria-label="Clear selected member">
                    <Icon name="close" />
                  </button>
                </div>
              ) : null}
              {!selectedMember && memberSearch.trim().length >= 2 ? (
                <div className="mt-2 grid gap-2">
                  {memberMatches.length === 0 ? <p className="text-xs text-[var(--color-pib-text-muted)]">No owner-org members match this search.</p> : null}
                  {memberMatches.map((member) => (
                    <button
                      key={member.uid}
                      type="button"
                      aria-label={`Select ${labelForMember(member)}`}
                      onClick={() => {
                        setSelectedMember(member)
                        setMemberSearch(labelForMember(member))
                      }}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-left text-sm text-[var(--color-pib-text)] hover:border-[var(--color-primary)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{labelForMember(member)}</span>
                        {member.email ? <span className="block truncate text-xs text-[var(--color-pib-text-muted)]">{member.email}</span> : null}
                      </span>
                      <Icon name="person_add" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <label>
              <span className="pib-label mb-1 block">Role</span>
              <select value={memberRole} onChange={(event) => setMemberRole(event.target.value)} className="pib-select">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <button type="submit" className="pib-btn-primary text-xs font-label" disabled={submitting || !selectedMember?.uid}>Add member</button>
          </form>
        </div>

        <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
          <h3 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">External organisations</h3>
          <div className="mt-3 space-y-2">
            {data.organizations.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">{loading ? 'Loading organisations...' : 'No external organisations yet.'}</p> : null}
            {data.organizations.map((org) => (
              <div key={org.id || org.orgId || org.companyId} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{labelForOrganization(org)}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{org.role || 'viewer'}</p>
                </div>
                <StatusPill value={org.status} />
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
            <h4 className="text-sm font-medium text-[var(--color-pib-text)]">Link an existing organisation</h4>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Every member of the linked organisation can open this project from their own organisation workspace.</p>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!targetOrgId) return
                if (await postAccess({ action: 'link_organization', targetOrgId, role: targetOrgRole })) {
                  setTargetOrgId('')
                }
              }}
            >
              <label>
                <span className="pib-label mb-1 block">Existing organisation</span>
                <select
                  value={targetOrgId}
                  onChange={(event) => setTargetOrgId(event.target.value)}
                  className="pib-select w-full"
                  disabled={accessibleOrganizationsLoading || organizationOptions.length === 0}
                >
                  <option value="">{accessibleOrganizationsLoading ? 'Loading organisations...' : 'Select an organisation'}</option>
                  {organizationOptions.map((organization) => (
                    <option key={organization.id} value={organization.id}>{organization.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="pib-label mb-1 block">Role</span>
                <select value={targetOrgRole} onChange={(event) => setTargetOrgRole(event.target.value)} className="pib-select w-full">
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <button type="submit" className="pib-btn-primary self-end text-xs font-label" disabled={submitting || !targetOrgId}>Link organisation</button>
            </form>
            {!accessibleOrganizationsLoading && organizationOptions.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">No other accessible organisations are available to link.</p>
            ) : null}
          </div>
          <div className="mt-4 border-t border-[var(--color-card-border)] pt-4">
            <h4 className="text-sm font-medium text-[var(--color-pib-text)]">Invite through CRM</h4>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Use a CRM company and contact when the organisation does not yet have a Partners in Biz workspace.</p>
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              if (!companyId.trim()) return
              postAccess({ action: 'invite_organizations', invites: [{ companyId: companyId.trim(), contactId: contactId.trim(), role: orgRole }] }).then(() => {
                setCompanyId('')
                setContactId('')
                setCompanySearch('')
                setCompanyResults([])
                setSelectedCompany(null)
                setSelectedContact(null)
                setContactResults([])
              })
            }}
          >
            <div className="sm:col-span-3">
              <label>
                <span className="pib-label mb-1 block">Search CRM company</span>
                <input
                  value={companySearch}
                  onChange={(event) => {
                    setCompanySearch(event.target.value)
                    setSelectedCompany(null)
                    setSelectedContact(null)
                    setCompanyId('')
                    setContactId('')
                  }}
                  placeholder="Search by company name or email"
                  className="pib-input"
                />
              </label>
              <div className="mt-2 grid gap-2">
                {companySearchLoading ? <p className="text-xs text-[var(--color-pib-text-muted)]">Searching companies...</p> : null}
                {companyResults.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    aria-label={`Select ${company.name || company.email || company.id}`}
                    onClick={() => {
                      setSelectedCompany(company)
                      setCompanyId(company.id)
                      setCompanySearch(company.name || company.email || company.id)
                      setCompanyResults([])
                      setSelectedContact(null)
                      setContactId('')
                    }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-left text-sm text-[var(--color-pib-text)] hover:border-[var(--color-primary)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{company.name || 'Unnamed company'}</span>
                      {company.email ? <span className="block truncate text-xs text-[var(--color-pib-text-muted)]">{company.email}</span> : null}
                    </span>
                    <Icon name="chevron_right" />
                  </button>
                ))}
                {!selectedCompany && companySearch.trim().length >= 2 ? (
                  <button
                    type="button"
                    onClick={() => createCrmCompany()}
                    disabled={companyCreating}
                    className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm font-medium text-[var(--color-pib-text)] hover:border-[var(--color-primary)] disabled:opacity-50"
                  >
                    <Icon name="add_business" />
                    {companyCreating ? 'Creating company...' : 'Create CRM company'}
                  </button>
                ) : null}
              </div>
              {selectedCompany ? (
                <p className="mt-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-xs text-[var(--color-pib-text)]">
                  Selected company: {selectedCompany.name || selectedCompany.email || selectedCompany.id}
                </p>
              ) : null}
            </div>
            {selectedCompany ? (
              <div className="sm:col-span-2">
                <p className="pib-label mb-1">CRM contact</p>
                <div className="grid gap-2">
                  {contactsLoading ? <p className="text-xs text-[var(--color-pib-text-muted)]">Loading contacts...</p> : null}
                  {!contactsLoading && contactResults.length === 0 ? <p className="text-xs text-[var(--color-pib-text-muted)]">No linked contacts found for this company.</p> : null}
                  {contactResults.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      aria-label={`Select ${contact.name || contact.email || contact.id}`}
                      onClick={() => {
                        setSelectedContact(contact)
                        setContactId(contact.id)
                      }}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-left text-sm text-[var(--color-pib-text)] hover:border-[var(--color-primary)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{contact.name || 'Unnamed contact'}</span>
                        {contact.email ? <span className="block truncate text-xs text-[var(--color-pib-text-muted)]">{contact.email}</span> : null}
                      </span>
                      <Icon name="person_add" />
                    </button>
                  ))}
                  <div className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label>
                        <span className="pib-label mb-1 block">New contact name</span>
                        <input
                          value={newContactName}
                          onChange={(event) => setNewContactName(event.target.value)}
                          className="pib-input"
                        />
                      </label>
                      <label>
                        <span className="pib-label mb-1 block">New contact email</span>
                        <input
                          type="email"
                          value={newContactEmail}
                          onChange={(event) => setNewContactEmail(event.target.value)}
                          className="pib-input"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => createCrmContact()}
                      disabled={contactCreating || !newContactName.trim() || !newContactEmail.trim()}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs font-label text-[var(--color-pib-text)] hover:border-[var(--color-primary)] disabled:opacity-50"
                    >
                      <Icon name="person_add" />
                      {contactCreating ? 'Creating contact...' : 'Create contact'}
                    </button>
                  </div>
                </div>
                {selectedContact ? (
                  <p className="mt-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-xs text-[var(--color-pib-text)]">
                    Selected contact: {selectedContact.name || selectedContact.email || selectedContact.id}
                  </p>
                ) : null}
              </div>
            ) : null}
            <label>
              <span className="pib-label mb-1 block">Role</span>
              <select value={orgRole} onChange={(event) => setOrgRole(event.target.value)} className="pib-select w-full">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <button type="submit" className="pib-btn-primary self-end text-xs font-label" disabled={submitting || !companyId.trim()}>Invite</button>
          </form>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
        <h3 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">Access audit</h3>
        <div className="mt-3 grid gap-2">
          {auditRows.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">{loading ? 'Loading audit...' : 'No access records yet.'}</p> : null}
          {auditRows.map((row) => (
            <div key={`${row.kind}-${row.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-[var(--color-pib-text)]">{row.label}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">{row.kind} / {row.role || 'viewer'}</p>
              </div>
              <StatusPill value={row.status} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

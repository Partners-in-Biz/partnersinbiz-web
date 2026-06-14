'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { FiCheckCircle, FiCopy, FiLink, FiSearch, FiUserCheck, FiUserPlus, FiX } from 'react-icons/fi'
import { TeamAccessGovernancePanel } from '@/components/settings/TeamAccessGovernancePanel'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface OrgMember {
  userId: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  displayName?: string
  email?: string
  photoURL?: string
  jobTitle?: string
  department?: string
  accessScope?: AccessScope
  accessNotes?: string
}

interface Organization {
  id: string
  name: string
  slug: string
}

interface PlatformUser {
  uid: string
  email: string
  displayName: string
}

interface ClientCandidate {
  uid: string
  email: string
  displayName: string
  photoURL?: string
}

const ROLE_OPTIONS: Array<{ value: OrgMember['role']; label: string; description: string }> = [
  { value: 'admin', label: 'Admin', description: 'Can manage this client workspace' },
  { value: 'member', label: 'Member', description: 'Can work inside the selected org workspace' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only selected org workspace access' },
]

type AccessScope = 'none' | 'all' | 'crm' | 'marketing' | 'projects' | 'billing' | 'readonly'

const ACCESS_SCOPE_OPTIONS: Array<{ value: AccessScope; label: string }> = [
  { value: 'none', label: 'No workspace areas yet' },
  { value: 'all', label: 'All workspace areas' },
  { value: 'crm', label: 'CRM and contacts' },
  { value: 'marketing', label: 'Marketing and content' },
  { value: 'projects', label: 'Projects and delivery' },
  { value: 'billing', label: 'Billing and documents' },
  { value: 'readonly', label: 'Read-only oversight' },
]

function accessScopeLabel(value?: AccessScope) {
  return ACCESS_SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? 'No workspace areas yet'
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { label: string; color: string }> = {
    owner: { label: 'Owner', color: 'var(--color-accent-v2)' },
    admin: { label: 'Admin', color: '#2563eb' },
    member: { label: 'Member', color: '#6b7280' },
    viewer: { label: 'Viewer', color: '#9ca3af' },
  }
  const r = map[role] ?? { label: role, color: 'var(--color-outline)' }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${r.color}20`, color: r.color }}
    >
      {r.label}
    </span>
  )
}

function Avatar({ name, photoURL }: { name?: string; photoURL?: string }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name}
        className="w-8 h-8 rounded-full object-cover"
      />
    )
  }

  // Initials fallback
  const initials = (name ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('')

  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-on-surface"
      style={{ backgroundColor: 'var(--color-accent-v2)' }}
    >
      {initials}
    </div>
  )
}

function isProvisioningAgentMember(member: OrgMember): boolean {
  return (member.userId === 'ai-agent' || member.userId.startsWith('agent:')) && !member.displayName && !member.email
}

function InviteCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface)]/60 p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-v2)]/12 text-[var(--color-accent-v2)]">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-headline font-semibold text-on-surface">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function FieldShell({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-md border border-[var(--color-outline)] bg-[var(--color-card)] focus-within:border-[var(--color-accent-v2)] focus-within:ring-1 focus-within:ring-[var(--color-accent-v2)] ${className}`}>
      {children}
    </div>
  )
}

function RoleSelect({
  value,
  onChange,
  disabled,
  label = 'Role',
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <label className="block min-w-[150px] flex-1 sm:flex-none">
      <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <FieldShell>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full bg-transparent px-3 text-sm text-on-surface outline-none"
          disabled={disabled}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldShell>
      <span className="mt-1 block text-[11px] leading-snug text-on-surface-variant">
        {ROLE_OPTIONS.find((option) => option.value === value)?.description}
      </span>
    </label>
  )
}

function AccessFields({
  jobTitle,
  department,
  accessScope,
  accessNotes,
  onJobTitle,
  onDepartment,
  onAccessScope,
  onAccessNotes,
  disabled,
}: {
  jobTitle: string
  department: string
  accessScope: AccessScope
  accessNotes: string
  onJobTitle: (value: string) => void
  onDepartment: (value: string) => void
  onAccessScope: (value: AccessScope) => void
  onAccessNotes: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-3 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Job title</span>
          <FieldShell>
            <input
              type="text"
              placeholder="Finance Manager"
              value={jobTitle}
              onChange={(e) => onJobTitle(e.target.value)}
              className="h-10 w-full bg-transparent px-3 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
              disabled={disabled}
            />
          </FieldShell>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Department</span>
          <FieldShell>
            <input
              type="text"
              placeholder="Operations"
              value={department}
              onChange={(e) => onDepartment(e.target.value)}
              className="h-10 w-full bg-transparent px-3 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
              disabled={disabled}
            />
          </FieldShell>
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Access scope</span>
        <FieldShell>
          <select
            value={accessScope}
            onChange={(e) => onAccessScope(e.target.value as AccessScope)}
            className="h-10 w-full bg-transparent px-3 text-sm text-on-surface outline-none"
            disabled={disabled}
          >
            {ACCESS_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Internal access note</span>
        <FieldShell>
          <textarea
            rows={2}
            placeholder="Context for this person's responsibilities"
            value={accessNotes}
            onChange={(e) => onAccessNotes(e.target.value)}
            className="w-full resize-none bg-transparent px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
            disabled={disabled}
          />
        </FieldShell>
      </label>
    </div>
  )
}

export default function TeamPage() {
  const params = useParams()
  const slug = params.slug as string

  const [org, setOrg] = useState<Organization | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create login form state
  const [creatingLogin, setCreatingLogin] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createRole, setCreateRole] = useState('member')
  const [createJobTitle, setCreateJobTitle] = useState('')
  const [createDepartment, setCreateDepartment] = useState('')
  const [createAccessScope, setCreateAccessScope] = useState<AccessScope>('none')
  const [createAccessNotes, setCreateAccessNotes] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [setupLink, setSetupLink] = useState<string | null>(null)

  // Add existing client form state
  const [addingClient, setAddingClient] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clientUid, setClientUid] = useState('')
  const [clientRole, setClientRole] = useState('member')
  const [clientJobTitle, setClientJobTitle] = useState('')
  const [clientDepartment, setClientDepartment] = useState('')
  const [clientAccessScope, setClientAccessScope] = useState<AccessScope>('none')
  const [clientAccessNotes, setClientAccessNotes] = useState('')
  const [clientCandidates, setClientCandidates] = useState<ClientCandidate[]>([])
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const [clientSearchLoading, setClientSearchLoading] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const clientSearchRef = useRef<HTMLDivElement>(null)

  // Add member form state
  const [addingMember, setAddingMember] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [addRole, setAddRole] = useState('member')
  const [addJobTitle, setAddJobTitle] = useState('')
  const [addDepartment, setAddDepartment] = useState('')
  const [addAccessScope, setAddAccessScope] = useState<AccessScope>('none')
  const [addAccessNotes, setAddAccessNotes] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const addSearchRef = useRef<HTMLDivElement>(null)

  // Updating role
  const [updatingRole, setUpdatingRole] = useState<string | null>(null)
  const [updatingError, setUpdatingError] = useState<string | null>(null)

  // Fetch platform users once for autocomplete
  useEffect(() => {
    fetch('/api/v1/admin/platform-users')
      .then((r) => r.json())
      .then((b) => setPlatformUsers(b.data ?? []))
      .catch(() => {})
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addSearchRef.current && !addSearchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Search existing client accounts for this organization.
  useEffect(() => {
    if (!org) return

    const q = clientSearch.trim()
    if (q.length < 2 || clientUid) {
      setClientCandidates([])
      setClientSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setClientSearchLoading(true)
        const res = await fetch(
          `/api/v1/organizations/${org.id}/members/client?q=${encodeURIComponent(q)}`,
          { signal: controller.signal, headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug } },
        )
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Failed to search clients')
        setClientCandidates(body.data ?? [])
        setClientDropdownOpen(true)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setClientCandidates([])
      } finally {
        if (!controller.signal.aborted) setClientSearchLoading(false)
      }
    }, 200)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [org, clientSearch, clientUid, slug])

  // Load organization and members
  useEffect(() => {
    const fetchOrgAndMembers = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch all orgs and find by slug
        const orgsRes = await fetch('/api/v1/organizations')
        if (!orgsRes.ok) throw new Error('Failed to fetch organizations')

        const orgsBody = await orgsRes.json()
        const orgs = Array.isArray(orgsBody.data) ? (orgsBody.data as Organization[]) : []
        const foundOrg = orgs.find((o) => o.slug === slug)
        if (!foundOrg) throw new Error('Organization not found')

        setOrg(foundOrg)

        // Fetch members
        const membersRes = await fetch(`/api/v1/organizations/${foundOrg.id}/members`, { headers: { 'X-Org-Id': foundOrg.id, 'X-Org-Slug': slug } })
        if (!membersRes.ok) throw new Error('Failed to fetch members')

        const membersBody = await membersRes.json()
        setMembers(membersBody.data ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    if (slug) {
      fetchOrgAndMembers()
    }
  }, [slug])

  const handleCreateLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!org || !createEmail || !createName) return
    setCreatingLogin(true)
    setCreateError(null)
    setSetupLink(null)
    try {
      const res = await fetch(`/api/v1/organizations/${org.id}/create-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': org.id, 'X-Org-Slug': slug },
        body: JSON.stringify({
          email: createEmail,
          name: createName,
          role: createRole,
          jobTitle: createJobTitle,
          department: createDepartment,
          accessScope: createAccessScope,
          accessNotes: createAccessNotes,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to create login')
      setMembers([
        ...members,
        {
          userId: body.data.uid,
          role: body.data.role,
          email: body.data.email,
          displayName: body.data.displayName,
          jobTitle: body.data.jobTitle,
          department: body.data.department,
          accessScope: body.data.accessScope,
          accessNotes: body.data.accessNotes,
        },
      ])
      setSetupLink(body.data.setupLink)
      setCreateName('')
      setCreateEmail('')
      setCreateRole('member')
      setCreateJobTitle('')
      setCreateDepartment('')
      setCreateAccessScope('none')
      setCreateAccessNotes('')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setCreatingLogin(false)
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!org || !addEmail) return

    try {
      setAddError(null)
      setAddingMember(true)

      const res = await fetch(`/api/v1/organizations/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': org.id, 'X-Org-Slug': slug },
        body: JSON.stringify({
          email: addEmail,
          role: addRole,
          jobTitle: addJobTitle,
          department: addDepartment,
          accessScope: addAccessScope,
          accessNotes: addAccessNotes,
        }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to add member')
      }

      // Add to local state
      setMembers([...members, body.data])
      setAddEmail('')
      setAddSearch('')
      setAddRole('member')
      setAddJobTitle('')
      setAddDepartment('')
      setAddAccessScope('none')
      setAddAccessNotes('')
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setAddingMember(false)
    }
  }

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!org || !clientUid) return

    try {
      setClientError(null)
      setAddingClient(true)

      const res = await fetch(`/api/v1/organizations/${org.id}/members/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': org.id, 'X-Org-Slug': slug },
        body: JSON.stringify({
          uid: clientUid,
          role: clientRole,
          jobTitle: clientJobTitle,
          department: clientDepartment,
          accessScope: clientAccessScope,
          accessNotes: clientAccessNotes,
        }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to add client')
      }

      setMembers([...members, body.data])
      setClientUid('')
      setClientSearch('')
      setClientRole('member')
      setClientJobTitle('')
      setClientDepartment('')
      setClientAccessScope('none')
      setClientAccessNotes('')
      setClientCandidates([])
      setClientDropdownOpen(false)
    } catch (e) {
      setClientError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setAddingClient(false)
    }
  }

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!org) return

    try {
      setUpdatingError(null)
      setUpdatingRole(userId)

      const res = await fetch(`/api/v1/organizations/${org.id}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': org.id, 'X-Org-Slug': slug },
        body: JSON.stringify({ role: newRole }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to update role')
      }

      // Update local state
      setMembers(
        members.map((m) => (
          m.userId === userId ? { ...m, role: newRole as OrgMember['role'] } : m
        )),
      )
    } catch (e) {
      setUpdatingError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setUpdatingRole(null)
    }
  }

  const handleChangeAccessScope = async (userId: string, accessScope: AccessScope) => {
    if (!org) return

    try {
      setUpdatingError(null)
      setUpdatingRole(userId)

      const res = await fetch(`/api/v1/organizations/${org.id}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': org.id, 'X-Org-Slug': slug },
        body: JSON.stringify({ accessScope }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to update access scope')
      }

      setMembers(
        members.map((m) => (
          m.userId === userId ? { ...m, accessScope } : m
        )),
      )
    } catch (e) {
      setUpdatingError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setUpdatingRole(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!org || !confirm('Are you sure you want to remove this member?')) return

    try {
      const res = await fetch(`/api/v1/organizations/${org.id}/members/${userId}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug },
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to remove member')
      }

      // Remove from local state
      setMembers(members.filter((m) => m.userId !== userId))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'An error occurred')
    }
  }

  function prepareCrmInvite() {
    setCreateRole('member')
    setCreateDepartment('Sales')
    setCreateAccessScope('crm')
    setClientRole('member')
    setClientDepartment('Sales')
    setClientAccessScope('crm')
    setAddRole('member')
    setAddDepartment('Sales')
    setAddAccessScope('crm')
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Workspace / Team
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Team</h1>
      </div>

      {/* Error */}
      {error && (
        <div
          className="pib-card border-l-4 p-4"
          style={{ borderColor: '#ef4444', backgroundColor: '#fef2f2' }}
        >
          <p className="text-sm text-[#7f1d1d]">{error}</p>
        </div>
      )}

      {!loading && org && (
        <TeamAccessGovernancePanel
          members={members}
          canPrepareCrmInvite
          onPrepareCrmInvite={prepareCrmInvite}
        />
      )}

      {/* Create Client Login */}
      {!loading && org && (
        <div className="pib-card !p-0 overflow-visible">
          <div className="border-b border-[var(--color-card-border)] px-5 py-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Invites & Access
            </p>
            <h2 className="mt-1 text-lg font-headline font-semibold text-on-surface">Add people to this workspace</h2>
            <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
              Create a new client login, attach an existing client account, or grant a PiB staff member explicit access to this selected org.
            </p>
          </div>
          <div className="grid gap-4 p-5 xl:grid-cols-3">
            <InviteCard
              icon={<FiLink aria-hidden="true" className="h-4 w-4" />}
              title="Create client login"
              description="Creates the Firebase account, adds it to this organisation, emails the welcome setup link, and shows the setup link here."
            >
              <form onSubmit={handleCreateLogin} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Full name</span>
                  <FieldShell>
                    <input
                      type="text"
                      placeholder="Jane Client"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      className="h-11 w-full bg-transparent px-3 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
                      disabled={creatingLogin}
                      required
                    />
                  </FieldShell>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Email</span>
                  <FieldShell>
                    <input
                      type="email"
                      placeholder="client@example.com"
                      value={createEmail}
                      onChange={(e) => setCreateEmail(e.target.value)}
                      className="h-11 w-full bg-transparent px-3 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
                      disabled={creatingLogin}
                      required
                    />
                  </FieldShell>
                </label>
                <RoleSelect value={createRole} onChange={setCreateRole} disabled={creatingLogin} />
                <AccessFields
                  jobTitle={createJobTitle}
                  department={createDepartment}
                  accessScope={createAccessScope}
                  accessNotes={createAccessNotes}
                  onJobTitle={setCreateJobTitle}
                  onDepartment={setCreateDepartment}
                  onAccessScope={setCreateAccessScope}
                  onAccessNotes={setCreateAccessNotes}
                  disabled={creatingLogin}
                />
                <button
                  type="submit"
                  className="pib-btn-primary flex w-full items-center justify-center gap-2 text-sm font-label"
                  disabled={creatingLogin || !createEmail || !createName}
                >
                  <FiUserPlus aria-hidden="true" className="h-4 w-4" />
                  {creatingLogin ? 'Creating...' : 'Create Login'}
                </button>
              </form>
              {createError && <p className="mt-2 text-xs text-[#ef4444]">{createError}</p>}
              {setupLink && (
                <div className="mt-3 rounded-md border border-[var(--color-outline)] bg-[var(--color-card)] p-3">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    <FiCheckCircle aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-accent-v2)]" />
                    Setup link ready
                  </div>
                  <code className="block max-h-16 overflow-auto break-all text-xs text-on-surface">{setupLink}</code>
                  <button
                    type="button"
                    onClick={() => { copyToClipboard(setupLink); }}
                    className="pib-btn-secondary mt-3 flex w-full items-center justify-center gap-2 text-xs font-label"
                  >
                    <FiCopy aria-hidden="true" className="h-3.5 w-3.5" />
                    Copy link
                  </button>
                </div>
              )}
            </InviteCard>

            <InviteCard
              icon={<FiSearch aria-hidden="true" className="h-4 w-4" />}
              title="Add existing client"
              description="Searches client-role accounts, excludes current members, and adds the selected client with the role below."
            >
              <form onSubmit={handleAddClient} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Client account</span>
                  <div ref={clientSearchRef} className="relative">
                    <FieldShell>
                      <input
                        type="text"
                        placeholder="Search existing client..."
                        value={clientSearch}
                        onChange={(e) => {
                          setClientSearch(e.target.value)
                          setClientUid('')
                          setClientDropdownOpen(true)
                        }}
                        onFocus={() => {
                          if (clientSearch.trim().length >= 2) setClientDropdownOpen(true)
                        }}
                        className="h-11 w-full bg-transparent px-3 pr-10 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
                        disabled={addingClient}
                        autoComplete="off"
                      />
                      {clientUid && (
                        <button
                          type="button"
                          onClick={() => {
                            setClientUid('')
                            setClientSearch('')
                            setClientCandidates([])
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-on-surface-variant hover:text-on-surface"
                          aria-label="Clear selected client"
                        >
                          <FiX aria-hidden="true" className="h-4 w-4" />
                        </button>
                      )}
                    </FieldShell>
                    {clientUid && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-accent-v2)]">
                        <FiCheckCircle aria-hidden="true" className="h-3.5 w-3.5" />
                        Client selected
                      </p>
                    )}
                    {clientDropdownOpen && clientSearch.trim().length >= 2 && !clientUid && (
                      <div className="absolute z-20 top-full mt-1 max-h-64 w-full overflow-auto rounded-md border border-[var(--color-outline)] bg-[var(--color-card)] shadow-lg">
                        {clientSearchLoading ? (
                          <div className="px-3 py-2 text-xs text-on-surface-variant">
                            Searching clients...
                          </div>
                        ) : clientCandidates.length > 0 ? (
                          <ul>
                            {clientCandidates.map((client) => (
                              <li
                                key={client.uid}
                                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--color-row-hover)]"
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  setClientUid(client.uid)
                                  setClientSearch(`${client.displayName || client.email} (${client.email})`)
                                  setClientCandidates([])
                                  setClientDropdownOpen(false)
                                }}
                              >
                                <Avatar name={client.displayName || client.email} photoURL={client.photoURL} />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-on-surface">{client.displayName || 'Client'}</p>
                                  <p className="truncate text-xs text-on-surface-variant">{client.email}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="px-3 py-2 text-xs text-on-surface-variant">
                            No matching client accounts found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </label>
                <RoleSelect value={clientRole} onChange={setClientRole} disabled={addingClient} />
                <AccessFields
                  jobTitle={clientJobTitle}
                  department={clientDepartment}
                  accessScope={clientAccessScope}
                  accessNotes={clientAccessNotes}
                  onJobTitle={setClientJobTitle}
                  onDepartment={setClientDepartment}
                  onAccessScope={setClientAccessScope}
                  onAccessNotes={setClientAccessNotes}
                  disabled={addingClient}
                />
                <button
                  type="submit"
                  className="pib-btn-primary flex w-full items-center justify-center gap-2 text-sm font-label"
                  disabled={addingClient || !clientUid}
                >
                  <FiUserCheck aria-hidden="true" className="h-4 w-4" />
                  {addingClient ? 'Adding...' : 'Add Client'}
                </button>
              </form>
              {clientError && (
                <p className="mt-2 text-xs text-[#ef4444]">{clientError}</p>
              )}
            </InviteCard>

            <InviteCard
              icon={<FiUserCheck aria-hidden="true" className="h-4 w-4" />}
              title="Add existing PiB member"
              description="Searches platform staff accounts and grants explicit access to this selected client org workspace."
            >
              <form onSubmit={handleAddMember} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Staff account</span>
                  <div ref={addSearchRef} className="relative">
                    <FieldShell>
                      <input
                        type="text"
                        placeholder="Search staff..."
                        value={addSearch}
                        onChange={(e) => {
                          setAddSearch(e.target.value)
                          setAddEmail(e.target.value)
                          setShowDropdown(true)
                        }}
                        onFocus={() => setShowDropdown(true)}
                        className="h-11 w-full bg-transparent px-3 pr-10 text-sm text-on-surface placeholder:text-on-surface-variant outline-none"
                        disabled={addingMember}
                        autoComplete="off"
                      />
                      {addEmail && addSearch.includes('(') && (
                        <button
                          type="button"
                          onClick={() => {
                            setAddEmail('')
                            setAddSearch('')
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-on-surface-variant hover:text-on-surface"
                          aria-label="Clear selected member"
                        >
                          <FiX aria-hidden="true" className="h-4 w-4" />
                        </button>
                      )}
                    </FieldShell>
                    {addEmail && addSearch.includes('(') && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-accent-v2)]">
                        <FiCheckCircle aria-hidden="true" className="h-3.5 w-3.5" />
                        Staff member selected
                      </p>
                    )}
                    {showDropdown && addSearch.trim().length > 0 && (() => {
                      const q = addSearch.trim().toLowerCase()
                      const matches = platformUsers.filter(
                        (u) =>
                          !members.some((m) => m.email === u.email) &&
                          (u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)),
                      )
                      return matches.length > 0 ? (
                        <ul className="absolute z-20 top-full mt-1 max-h-64 w-full overflow-auto rounded-md border border-[var(--color-outline)] bg-[var(--color-card)] shadow-lg">
                          {matches.map((u) => (
                            <li
                              key={u.uid}
                              className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--color-row-hover)]"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                setAddEmail(u.email)
                                setAddSearch(`${u.displayName || u.email} (${u.email})`)
                                setShowDropdown(false)
                              }}
                            >
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-v2)] text-xs font-bold text-black">
                                {(u.displayName || u.email)[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-on-surface">{u.displayName || 'Team member'}</p>
                                <p className="truncate text-xs text-on-surface-variant">{u.email}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="absolute z-20 top-full mt-1 w-full rounded-md border border-[var(--color-outline)] bg-[var(--color-card)] px-3 py-2 text-xs text-on-surface-variant shadow-lg">
                          No matching staff accounts found
                        </div>
                      )
                    })()}
                  </div>
                </label>
                <RoleSelect value={addRole} onChange={setAddRole} disabled={addingMember} />
                <AccessFields
                  jobTitle={addJobTitle}
                  department={addDepartment}
                  accessScope={addAccessScope}
                  accessNotes={addAccessNotes}
                  onJobTitle={setAddJobTitle}
                  onDepartment={setAddDepartment}
                  onAccessScope={setAddAccessScope}
                  onAccessNotes={setAddAccessNotes}
                  disabled={addingMember}
                />
                <button
                  type="submit"
                  className="pib-btn-primary flex w-full items-center justify-center gap-2 text-sm font-label"
                  disabled={addingMember || !addEmail}
                >
                  <FiUserCheck aria-hidden="true" className="h-4 w-4" />
                  {addingMember ? 'Adding...' : 'Add Member'}
                </button>
              </form>
              {addError && (
                <p className="mt-2 text-xs text-[#ef4444]">{addError}</p>
              )}
            </InviteCard>
          </div>
        </div>
      )}

      {/* Members Table */}
      <div className="pib-card">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">
          Members ({members.length})
        </p>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-on-surface-variant text-sm">No team members yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-on-surface-variant/20">
                  <th className="text-left py-2 px-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Member
                  </th>
                  <th className="text-left py-2 px-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Email
                  </th>
                  <th className="text-left py-2 px-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Position
                  </th>
                  <th className="text-left py-2 px-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Role
                  </th>
                  <th className="text-left py-2 px-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Access
                  </th>
                  <th className="text-right py-2 px-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.userId}
                    className="border-b border-on-surface-variant/10 hover:bg-[var(--color-row-hover)] transition-colors"
                  >
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={member.displayName} photoURL={member.photoURL} />
                        <span className="text-on-surface font-medium text-sm">
                          {isProvisioningAgentMember(member) ? 'Provisioning agent' : member.displayName || 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-on-surface-variant text-sm">{member.email || '—'}</span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="max-w-[180px] text-sm">
                        <p className="truncate text-on-surface">{member.jobTitle || '—'}</p>
                        {member.department && (
                          <p className="truncate text-xs text-on-surface-variant">{member.department}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <RoleBadge role={member.role} />
                        {member.role !== 'owner' && (
                          <select
                            value={member.role}
                            onChange={(e) => handleChangeRole(member.userId, e.target.value)}
                            disabled={updatingRole === member.userId}
                            className="text-xs px-2 py-1 rounded-md opacity-0 hover:opacity-100 transition-opacity"
                            style={{
                              backgroundColor: 'var(--color-surface)',
                              border: '1px solid var(--color-outline)',
                            }}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="max-w-[220px] text-sm">
                        {member.role !== 'owner' ? (
                          <select
                            value={member.accessScope ?? 'none'}
                            onChange={(e) => handleChangeAccessScope(member.userId, e.target.value as AccessScope)}
                            disabled={updatingRole === member.userId}
                            aria-label={`Change access for ${member.displayName || member.email || member.userId}`}
                            className="w-full rounded-md border border-[var(--color-outline)] bg-[var(--color-surface)] px-2 py-1 text-xs text-on-surface-variant"
                          >
                            {ACCESS_SCOPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-on-surface-variant">{accessScopeLabel(member.accessScope)}</p>
                        )}
                        {member.accessNotes && (
                          <p className="mt-0.5 truncate text-xs text-on-surface-variant/70">{member.accessNotes}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {(member.role !== 'owner' || isProvisioningAgentMember(member)) && (
                        <button
                          onClick={() => handleRemoveMember(member.userId)}
                          className="text-xs text-[#ef4444] hover:text-[#dc2626] font-medium"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {updatingError && (
          <p className="text-xs text-[#ef4444] mt-2">{updatingError}</p>
        )}
      </div>
    </div>
  )
}

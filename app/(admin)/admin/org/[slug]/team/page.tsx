'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface OrgMember {
  userId: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  displayName?: string
  email?: string
  photoURL?: string
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
  const [createError, setCreateError] = useState<string | null>(null)
  const [setupLink, setSetupLink] = useState<string | null>(null)

  // Add existing client form state
  const [addingClient, setAddingClient] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clientUid, setClientUid] = useState('')
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
          { signal: controller.signal },
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
  }, [org, clientSearch, clientUid])

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
        const membersRes = await fetch(`/api/v1/organizations/${foundOrg.id}/members`)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: createEmail, name: createName, role: createRole }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to create login')
      setMembers([...members, { userId: body.data.uid, role: body.data.role, email: body.data.email, displayName: body.data.displayName }])
      setSetupLink(body.data.setupLink)
      setCreateName('')
      setCreateEmail('')
      setCreateRole('member')
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addEmail, role: addRole }),
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: clientUid }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to add client')
      }

      setMembers([...members, body.data])
      setClientUid('')
      setClientSearch('')
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
        headers: { 'Content-Type': 'application/json' },
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

  const handleRemoveMember = async (userId: string) => {
    if (!org || !confirm('Are you sure you want to remove this member?')) return

    try {
      const res = await fetch(`/api/v1/organizations/${org.id}/members/${userId}`, {
        method: 'DELETE',
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

      {/* Create Client Login */}
      {!loading && org && (
        <div className="pib-card">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Create Client Login
          </p>
          <p className="text-xs text-on-surface-variant mb-3">
            Creates a new account and adds the client to this organisation. A setup link is generated for the client to set their password.
          </p>
          <form onSubmit={handleCreateLogin} className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Full name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="flex-1 min-w-[160px] px-3 py-2 rounded-md text-sm"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
              disabled={creatingLogin}
              required
            />
            <input
              type="email"
              placeholder="client@example.com"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 rounded-md text-sm"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
              disabled={creatingLogin}
              required
            />
            <select
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value)}
              className="px-3 py-2 rounded-md text-sm"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
              disabled={creatingLogin}
            >
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              className="pib-btn-primary text-sm font-label"
              disabled={creatingLogin || !createEmail || !createName}
            >
              {creatingLogin ? 'Creating...' : 'Create Login'}
            </button>
          </form>
          {createError && <p className="text-xs text-[#ef4444] mt-2">{createError}</p>}
          {setupLink && (
            <div className="mt-3 p-3 rounded-md" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
                Setup Link — send this to the client
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-on-surface break-all flex-1">{setupLink}</code>
                <button
                  type="button"
                  onClick={() => { copyToClipboard(setupLink); }}
                  className="pib-btn-secondary text-xs font-label shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Existing Client */}
      {!loading && org && (
        <div className="pib-card">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Add Existing Client
          </p>
          <p className="text-xs text-on-surface-variant mb-3">
            Search client accounts already on the system and add them to this organisation as client members.
          </p>
          <form onSubmit={handleAddClient} className="flex gap-2 flex-wrap">
            <div ref={clientSearchRef} className="relative flex-1 min-w-[240px]">
              <input
                type="text"
                placeholder="Search existing client by name or email..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value)
                  setClientUid('')
                  setClientDropdownOpen(true)
                }}
                onFocus={() => {
                  if (clientSearch.trim().length >= 2) setClientDropdownOpen(true)
                }}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                disabled={addingClient}
                autoComplete="off"
              />
              {clientDropdownOpen && clientSearch.trim().length >= 2 && (
                <div
                  className="absolute z-20 top-full mt-1 w-full rounded-md shadow-lg overflow-hidden"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                >
                  {clientSearchLoading ? (
                    <div className="px-3 py-2 text-xs text-on-surface-variant">
                      Searching clients...
                    </div>
                  ) : clientCandidates.length > 0 ? (
                    <ul>
                      {clientCandidates.map((client) => (
                        <li
                          key={client.uid}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-on-surface/5 text-sm"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setClientUid(client.uid)
                            setClientSearch(`${client.displayName} (${client.email})`)
                            setClientCandidates([])
                            setClientDropdownOpen(false)
                          }}
                        >
                          <Avatar name={client.displayName || client.email} photoURL={client.photoURL} />
                          <div className="min-w-0">
                            <p className="text-on-surface font-medium truncate">{client.displayName}</p>
                            <p className="text-on-surface-variant text-xs truncate">{client.email}</p>
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
            <button
              type="submit"
              className="pib-btn-primary text-sm font-label"
              disabled={addingClient || !clientUid}
            >
              {addingClient ? 'Adding...' : 'Add Client'}
            </button>
          </form>
          {clientError && (
            <p className="text-xs text-[#ef4444] mt-2">{clientError}</p>
          )}
        </div>
      )}

      {/* Add Member Form */}
      {!loading && org && (
        <div className="pib-card">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Add Existing Member
          </p>
          <p className="text-xs text-on-surface-variant mb-3">
            Add a PiB staff member who already has an account. To give a client access, use &ldquo;Create Client Login&rdquo; above.
          </p>
          <form onSubmit={handleAddMember} className="flex gap-2 flex-wrap">
            <div ref={addSearchRef} className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search by name or email..."
                value={addSearch}
                onChange={(e) => {
                  setAddSearch(e.target.value)
                  setAddEmail(e.target.value)
                  setShowDropdown(true)
                }}
                onFocus={() => setShowDropdown(true)}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                disabled={addingMember}
                autoComplete="off"
              />
              {showDropdown && addSearch.trim().length > 0 && (() => {
                const q = addSearch.trim().toLowerCase()
                const matches = platformUsers.filter(
                  (u) =>
                    !members.some((m) => m.email === u.email) &&
                    (u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)),
                )
                return matches.length > 0 ? (
                  <ul
                    className="absolute z-20 top-full mt-1 w-full rounded-md shadow-lg overflow-hidden"
                    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                  >
                    {matches.map((u) => (
                      <li
                        key={u.uid}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-on-surface/5 text-sm"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setAddEmail(u.email)
                          setAddSearch(`${u.displayName} (${u.email})`)
                          setShowDropdown(false)
                        }}
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: 'var(--color-accent-v2)', color: 'var(--color-on-surface)' }}
                        >
                          {(u.displayName || u.email)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-on-surface font-medium truncate">{u.displayName}</p>
                          <p className="text-on-surface-variant text-xs truncate">{u.email}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div
                    className="absolute z-20 top-full mt-1 w-full rounded-md px-3 py-2 text-xs text-on-surface-variant"
                    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                  >
                    No matching staff accounts found
                  </div>
                )
              })()}
            </div>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="px-3 py-2 rounded-md text-sm"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
              disabled={addingMember}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="submit"
              className="pib-btn-primary text-sm font-label"
              disabled={addingMember || !addEmail}
            >
              {addingMember ? 'Adding...' : 'Add'}
            </button>
          </form>
          {addError && (
            <p className="text-xs text-[#ef4444] mt-2">{addError}</p>
          )}
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
                    Role
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

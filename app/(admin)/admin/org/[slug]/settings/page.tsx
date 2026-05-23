'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { copyToClipboard } from '@/lib/utils/clipboard'
import type { WorkspaceFolder } from '@/lib/workspace-folders/model'

interface OrgForm {
  // General settings
  name: string
  website: string
  description: string
  industry: string
  billingEmail: string
  status: string
  notificationEmail: string
  defaultApprovalRequired: boolean
  timezone: string
  // Email send-time optimisation
  preferredSendHourLocal: number
  preferredSendDaysOfWeek: number[]
  replyNotifyEmails: string
  // Billing address
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
  // Company billing details
  vatNumber: string
  registrationNumber: string
  phone: string
  // Banking
  bankName: string
  accountHolder: string
  accountNumber: string
  branchCode: string
  routingNumber: string
  swiftCode: string
  iban: string
}

const emptyForm: OrgForm = {
  name: '', website: '', description: '', industry: '', billingEmail: '',
  status: 'active', notificationEmail: '', defaultApprovalRequired: false, timezone: '',
  preferredSendHourLocal: 9, preferredSendDaysOfWeek: [1, 2, 3, 4, 5], replyNotifyEmails: '',
  line1: '', line2: '', city: '', state: '', postalCode: '', country: '',
  vatNumber: '', registrationNumber: '', phone: '',
  bankName: '', accountHolder: '', accountNumber: '', branchCode: '',
  routingNumber: '', swiftCode: '', iban: '',
}

type WorkspaceFolderWithId = WorkspaceFolder & { id: string }

function folderVisibilityLabel(value: WorkspaceFolder['visibility']) {
  if (value === 'admin_only') return 'Admin only'
  if (value === 'admin_agents_clients') return 'Admin + agents + clients'
  return 'Admin + agents'
}

function folderSourceOfTruthLabel(value: WorkspaceFolder['sourceOfTruth']) {
  if (value === 'google_drive') return 'Google Drive is source of truth'
  if (value === 'local') return 'Local Cowork is source of truth'
  if (value === 'vps') return 'VPS is source of truth'
  return 'Mixed source of truth'
}

function folderSyncModeLabel(value: WorkspaceFolder['syncMode']) {
  if (value === 'metadata_only') return 'Metadata only'
  if (value === 'manual') return 'Manual sync'
  return 'Full sync'
}

function folderSyncTargetLabel(value: WorkspaceFolder['syncTargets'][number]) {
  return value === 'local' ? 'Local Cowork' : 'VPS'
}

export default function OrgSettingsPage() {
  const params = useParams()
  const slug = params.slug as string

  const [orgId, setOrgId] = useState('')
  const [orgName, setOrgName] = useState('')
  const [form, setForm] = useState<OrgForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [folderMappings, setFolderMappings] = useState<WorkspaceFolderWithId[]>([])
  const [folderNotice, setFolderNotice] = useState('')
  const [resyncingFolderId, setResyncingFolderId] = useState<string | null>(null)

  function copyOrgId() {
    if (!orgId) return
    copyToClipboard(orgId).then(() => {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    })
  }

  useEffect(() => {
    async function load() {
      const orgsRes = await fetch('/api/v1/organizations')
      const orgsBody = await orgsRes.json()
      const org = (orgsBody.data ?? []).find((o: any) => o.slug === slug)
      if (!org) { setLoading(false); return }

      setOrgId(org.id)
      setOrgName(org.name)

      const detailRes = await fetch(`/api/v1/organizations/${org.id}`)
      const detailBody = await detailRes.json()
      const d = detailBody.data
      const folderRes = await fetch(`/api/v1/workspace-folders?orgId=${encodeURIComponent(org.id)}`)
      const folderBody = await folderRes.json().catch(() => ({ data: { folders: [] } }))
      const folders = Array.isArray(folderBody.data?.folders) ? folderBody.data.folders : []
      setFolderMappings(folders)
      if (d) {
        const bd = d.billingDetails ?? {}
        const addr = bd.address ?? {}
        const bank = bd.bankingDetails ?? {}
        const settings = d.settings ?? {}
        setForm({
          name: d.name ?? '',
          website: d.website ?? '',
          description: d.description ?? '',
          industry: d.industry ?? '',
          billingEmail: d.billingEmail ?? '',
          status: d.status ?? 'active',
          notificationEmail: settings.notificationEmail ?? '',
          defaultApprovalRequired: settings.defaultApprovalRequired ?? false,
          timezone: settings.timezone ?? '',
          preferredSendHourLocal:
            typeof settings.preferredSendHourLocal === 'number'
              ? settings.preferredSendHourLocal
              : 9,
          preferredSendDaysOfWeek: Array.isArray(settings.preferredSendDaysOfWeek)
            ? settings.preferredSendDaysOfWeek
            : [1, 2, 3, 4, 5],
          replyNotifyEmails: Array.isArray(settings.replyNotifyEmails)
            ? settings.replyNotifyEmails.join(', ')
            : '',
          line1: addr.line1 ?? '',
          line2: addr.line2 ?? '',
          city: addr.city ?? '',
          state: addr.state ?? '',
          postalCode: addr.postalCode ?? '',
          country: addr.country ?? '',
          vatNumber: bd.vatNumber ?? '',
          registrationNumber: bd.registrationNumber ?? '',
          phone: bd.phone ?? '',
          bankName: bank.bankName ?? '',
          accountHolder: bank.accountHolder ?? '',
          accountNumber: bank.accountNumber ?? '',
          branchCode: bank.branchCode ?? '',
          routingNumber: bank.routingNumber ?? '',
          swiftCode: bank.swiftCode ?? '',
          iban: bank.iban ?? '',
        })
      }
      setLoading(false)
    }
    if (slug) load()
  }, [slug])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)

    await fetch(`/api/v1/organizations/${orgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        website: form.website,
        description: form.description,
        industry: form.industry,
        billingEmail: form.billingEmail,
        status: form.status,
        settings: {
          notificationEmail: form.notificationEmail,
          defaultApprovalRequired: form.defaultApprovalRequired,
          timezone: form.timezone,
          preferredSendHourLocal: form.preferredSendHourLocal,
          preferredSendDaysOfWeek: form.preferredSendDaysOfWeek,
          replyNotifyEmails: form.replyNotifyEmails
            .split(/[\s,]+/)
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e && e.includes('@')),
        },
        billingDetails: {
          address: {
            line1: form.line1,
            line2: form.line2,
            city: form.city,
            state: form.state,
            postalCode: form.postalCode,
            country: form.country,
          },
          vatNumber: form.vatNumber,
          registrationNumber: form.registrationNumber,
          phone: form.phone,
          bankingDetails: {
            bankName: form.bankName,
            accountHolder: form.accountHolder,
            accountNumber: form.accountNumber,
            branchCode: form.branchCode,
            routingNumber: form.routingNumber,
            swiftCode: form.swiftCode,
            iban: form.iban,
          },
        },
      }),
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function update<K extends keyof OrgForm>(field: K, value: OrgForm[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleFolderResync(folder: WorkspaceFolderWithId) {
    setResyncingFolderId(folder.id)
    setFolderNotice('')
    const res = await fetch(`/api/v1/workspace-folders/${folder.id}/resync?orgId=${encodeURIComponent(orgId)}`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setFolderNotice(body.data?.message ?? body.error ?? 'Resync request recorded.')
    setResyncingFolderId(null)
  }

  if (loading) return <div className="pib-skeleton h-96 max-w-3xl mx-auto" />

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          {orgName} / Settings
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Organisation Settings</h1>
      </div>

      {/* Org ID */}
      {orgId && (
        <div className="pib-card-section">
          <div className="pib-card-section-header">
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Organisation ID</span>
          </div>
          <div className="pib-card-section-row">
            <span className="text-sm text-on-surface-variant">Org ID</span>
            <span className="flex items-center gap-2">
              <code className="font-mono text-xs text-on-surface bg-[var(--color-surface-container)] px-2 py-1 rounded select-all">{orgId}</code>
              <button type="button" onClick={copyOrgId} className="text-xs text-on-surface-variant hover:text-on-surface transition-colors px-2 py-1 rounded hover:bg-[var(--color-surface-container)]">
                {copiedId ? 'Copied!' : 'Copy'}
              </button>
            </span>
          </div>
          <div className="px-4 pb-3">
            <p className="text-[11px] text-on-surface-variant/60">Use this ID when configuring AI agents or API integrations for this organisation.</p>
          </div>
        </div>
      )}

      <div className="pib-card-section">
        <div className="pib-card-section-header flex items-start justify-between gap-4">
          <div>
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Workspace folder registry</span>
            <p className="mt-1 text-xs text-on-surface-variant">
              Map multiple Google Drive folders to each workspace/resource. PiB visibility controls what admins, agents, and clients can see; Drive ACLs remain the binary asset source-of-truth guardrail.
            </p>
          </div>
          <span className="rounded-full bg-[var(--color-surface-container)] px-3 py-1 text-[10px] font-label uppercase tracking-wider text-on-surface-variant">
            Portal exposure deferred
          </span>
        </div>
        <div className="divide-y divide-outline-variant/50">
          {folderMappings.length === 0 ? (
            <div className="p-4 text-sm text-on-surface-variant">
              No folder mappings yet. Add records through the folder mappings API once Drive folders and sync targets are agreed.
            </div>
          ) : folderMappings.map(folder => (
            <div key={folder.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-on-surface">{folder.name}</h2>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-primary">{folder.resourceType || 'workspace'}</span>
                    {folder.parentId && <span className="text-[11px] text-on-surface-variant">Parent: {folder.parentId}</span>}
                  </div>
                  <p className="mt-1 flex flex-wrap gap-1 text-xs text-on-surface-variant">
                    <span>{folderVisibilityLabel(folder.visibility)}</span>
                    <span>·</span>
                    <span>{folderSourceOfTruthLabel(folder.sourceOfTruth)}</span>
                    <span>·</span>
                    <span>{folderSyncModeLabel(folder.syncMode)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleFolderResync(folder)}
                  disabled={resyncingFolderId === folder.id}
                  className="pib-btn-secondary text-xs"
                  aria-label={`Resync ${folder.name}`}
                >
                  {resyncingFolderId === folder.id ? 'Requesting…' : 'Manual resync'}
                </button>
              </div>
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="font-label uppercase tracking-wide text-on-surface-variant">Drive</p>
                  <p className="mt-1 break-all text-on-surface">{folder.drive.folderId || 'No Drive ID set'}</p>
                  {folder.drive.folderUrl && <a className="mt-1 inline-block break-all text-primary hover:underline" href={folder.drive.folderUrl} target="_blank" rel="noreferrer">{folder.drive.folderUrl}</a>}
                </div>
                <div>
                  <p className="font-label uppercase tracking-wide text-on-surface-variant">Sync / audit</p>
                  <p className="mt-1 text-on-surface">Status: {folder.syncState.status} · Conflicts: {folder.audit.conflictStatus}</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-on-surface-variant">
                    <span>Targets:</span>
                    {folder.syncTargets.length ? folder.syncTargets.map(target => <span key={target}>{folderSyncTargetLabel(target)}</span>) : <span>Not configured</span>}
                  </div>
                </div>
                <div>
                  <p className="font-label uppercase tracking-wide text-on-surface-variant">Path hints</p>
                  <p className="mt-1 text-on-surface-variant">VPS: {folder.paths.vpsPath || '—'}</p>
                  <p className="text-on-surface-variant">Local: {folder.paths.localPathHint || '—'}</p>
                </div>
                <div>
                  <p className="font-label uppercase tracking-wide text-on-surface-variant">Tags / permissions</p>
                  <p className="mt-1 text-on-surface-variant">{folder.tags.length ? folder.tags.join(', ') : 'No tags'}</p>
                  <p className="mt-1 text-on-surface-variant">{folder.audit.notes || 'Hybrid permission model: PiB roles gate app/agent access; Drive permissions must be reviewed before adding clients.'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {folderNotice && <div className="border-t border-outline-variant/50 p-4 text-sm text-green-400">{folderNotice}</div>}
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* General Settings */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">General</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="pib-label">Organisation Name</label>
              <input value={form.name} onChange={e => update('name', e.target.value)} className="pib-input" placeholder="Acme Corp" />
            </div>
            <div>
              <label className="pib-label">Website</label>
              <input value={form.website} onChange={e => update('website', e.target.value)} className="pib-input" placeholder="https://acme.com" />
            </div>
            <div className="col-span-2">
              <label className="pib-label">Description</label>
              <textarea value={form.description} onChange={e => update('description', e.target.value)} className="pib-textarea" rows={3} placeholder="Brief description of the organisation" />
            </div>
            <div>
              <label className="pib-label">Industry</label>
              <input value={form.industry} onChange={e => update('industry', e.target.value)} className="pib-input" placeholder="e.g. Technology" />
            </div>
            <div>
              <label className="pib-label">Status</label>
              <select value={form.status} onChange={e => update('status', e.target.value)} className="pib-select">
                <option value="active">Active</option>
                <option value="onboarding">Onboarding</option>
                <option value="suspended">Suspended</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label className="pib-label">Billing Email</label>
              <input type="email" value={form.billingEmail} onChange={e => update('billingEmail', e.target.value)} className="pib-input" placeholder="billing@company.com" />
            </div>
            <div>
              <label className="pib-label">Notification Email</label>
              <input type="email" value={form.notificationEmail} onChange={e => update('notificationEmail', e.target.value)} className="pib-input" placeholder="notify@company.com" />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <input
                id="defaultApproval"
                type="checkbox"
                checked={form.defaultApprovalRequired}
                onChange={e => update('defaultApprovalRequired', e.target.checked)}
                className="h-4 w-4 rounded border-outline text-primary"
              />
              <label htmlFor="defaultApproval" className="pib-label mb-0 cursor-pointer">
                Require approval by default for new content
              </label>
            </div>
            <div>
              <label className="pib-label">Timezone</label>
              <select value={form.timezone} onChange={e => update('timezone', e.target.value)} className="pib-select">
                <option value="" disabled>Select timezone…</option>
                <option value="Africa/Johannesburg">Africa/Johannesburg (SAST, UTC+2)</option>
                <option value="America/Chicago">America/Chicago (CST, UTC-6)</option>
                <option value="America/Denver">America/Denver (MST, UTC-7)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST, UTC-8)</option>
                <option value="America/New_York">America/New_York (EST, UTC-5)</option>
                <option value="America/Sao_Paulo">America/Sao_Paulo (BRT, UTC-3)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (CST, UTC+8)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST, UTC+9)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST, UTC+10)</option>
                <option value="Europe/Amsterdam">Europe/Amsterdam (CET, UTC+1)</option>
                <option value="Europe/London">Europe/London (GMT, UTC+0)</option>
                <option value="Europe/Paris">Europe/Paris (CET, UTC+1)</option>
                <option value="Pacific/Auckland">Pacific/Auckland (NZST, UTC+12)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
        </div>

        {/* Email send-time + reply notifications */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Email send-time</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="pib-label">Preferred send hour (local)</label>
              <select
                value={form.preferredSendHourLocal}
                onChange={e => update('preferredSendHourLocal', parseInt(e.target.value, 10))}
                className="pib-select"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
              <p className="text-[11px] text-on-surface-variant/60 mt-1">
                Sequence steps and broadcasts will target this hour in the recipient&apos;s local timezone.
              </p>
            </div>
            <div>
              <label className="pib-label">Preferred send days</label>
              <div className="flex gap-1 flex-wrap">
                {[
                  { v: 0, l: 'Sun' },
                  { v: 1, l: 'Mon' },
                  { v: 2, l: 'Tue' },
                  { v: 3, l: 'Wed' },
                  { v: 4, l: 'Thu' },
                  { v: 5, l: 'Fri' },
                  { v: 6, l: 'Sat' },
                ].map((d) => {
                  const active = form.preferredSendDaysOfWeek.includes(d.v)
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() =>
                        update(
                          'preferredSendDaysOfWeek',
                          active
                            ? form.preferredSendDaysOfWeek.filter((x) => x !== d.v)
                            : [...form.preferredSendDaysOfWeek, d.v].sort(),
                        )
                      }
                      className={`px-2.5 py-1 rounded-md text-xs ${active ? 'bg-primary text-on-primary' : 'bg-[var(--color-surface-container)] text-on-surface-variant'}`}
                    >
                      {d.l}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-on-surface-variant/60 mt-1">
                Steps that fall on excluded days roll forward to the next allowed day.
              </p>
            </div>
            <div className="col-span-2">
              <label className="pib-label">Reply notification recipients</label>
              <input
                value={form.replyNotifyEmails}
                onChange={e => update('replyNotifyEmails', e.target.value)}
                className="pib-input"
                placeholder="sales@company.com, growth@company.com"
              />
              <p className="text-[11px] text-on-surface-variant/60 mt-1">
                Comma-separated. These addresses get notified whenever a contact replies (or bounces / unsubscribes via reply).
              </p>
            </div>
          </div>
        </div>

        {/* Billing Address */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Billing Address</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="pib-label">Street Address</label>
              <input value={form.line1} onChange={e => update('line1', e.target.value)} className="pib-input" placeholder="123 Main Street" />
            </div>
            <div className="col-span-2">
              <label className="pib-label">Address Line 2</label>
              <input value={form.line2} onChange={e => update('line2', e.target.value)} className="pib-input" placeholder="Suite 100 (optional)" />
            </div>
            <div>
              <label className="pib-label">City</label>
              <input value={form.city} onChange={e => update('city', e.target.value)} className="pib-input" placeholder="Cape Town" />
            </div>
            <div>
              <label className="pib-label">State / Province</label>
              <input value={form.state} onChange={e => update('state', e.target.value)} className="pib-input" placeholder="Western Cape" />
            </div>
            <div>
              <label className="pib-label">Postal Code</label>
              <input value={form.postalCode} onChange={e => update('postalCode', e.target.value)} className="pib-input" placeholder="8001" />
            </div>
            <div>
              <label className="pib-label">Country</label>
              <input value={form.country} onChange={e => update('country', e.target.value)} className="pib-input" placeholder="South Africa" />
            </div>
          </div>
        </div>

        {/* Company Details */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Company Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="pib-label">Phone</label>
              <input value={form.phone} onChange={e => update('phone', e.target.value)} className="pib-input" placeholder="+27 21 000 0000" />
            </div>
            <div>
              <label className="pib-label">VAT Number</label>
              <input value={form.vatNumber} onChange={e => update('vatNumber', e.target.value)} className="pib-input" placeholder="4000000000" />
            </div>
            <div>
              <label className="pib-label">Registration Number</label>
              <input value={form.registrationNumber} onChange={e => update('registrationNumber', e.target.value)} className="pib-input" placeholder="2020/000000/07" />
            </div>
          </div>
        </div>

        {/* Banking Details */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Banking Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="pib-label">Bank Name</label>
              <input value={form.bankName} onChange={e => update('bankName', e.target.value)} className="pib-input" placeholder="FNB" />
            </div>
            <div>
              <label className="pib-label">Account Holder</label>
              <input value={form.accountHolder} onChange={e => update('accountHolder', e.target.value)} className="pib-input" placeholder="Partners in Biz (Pty) Ltd" />
            </div>
            <div>
              <label className="pib-label">Account Number</label>
              <input value={form.accountNumber} onChange={e => update('accountNumber', e.target.value)} className="pib-input" placeholder="62000000000" />
            </div>
            <div>
              <label className="pib-label">Branch Code</label>
              <input value={form.branchCode} onChange={e => update('branchCode', e.target.value)} className="pib-input" placeholder="250655" />
            </div>
            <div>
              <label className="pib-label">Routing Number</label>
              <input value={form.routingNumber} onChange={e => update('routingNumber', e.target.value)} className="pib-input" placeholder="Optional" />
            </div>
            <div>
              <label className="pib-label">SWIFT Code</label>
              <input value={form.swiftCode} onChange={e => update('swiftCode', e.target.value)} className="pib-input" placeholder="FIRNZAJJ (optional)" />
            </div>
            <div>
              <label className="pib-label">IBAN</label>
              <input value={form.iban} onChange={e => update('iban', e.target.value)} className="pib-input" placeholder="Optional" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <button type="submit" disabled={saving} className="pib-btn-primary font-label">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && <span className="text-sm text-green-400">Saved successfully</span>}
        </div>
      </form>
    </div>
  )
}

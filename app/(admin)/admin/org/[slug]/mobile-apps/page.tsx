'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import type { MobileAppRecord, MobileAppPlatform, MobileAppStatus } from '@/lib/mobile-apps/types'

type OrgSummary = { id: string; name?: string; slug?: string }

type FormState = {
  id?: string
  name: string
  platform: MobileAppPlatform
  status: MobileAppStatus
  appStoreUrl: string
  playStoreUrl: string
  packageName: string
  bundleId: string
  developerName: string
  supportUrl: string
  privacyPolicyUrl: string
  websiteUrl: string
  title: string
  subtitle: string
  shortDescription: string
  longDescription: string
  keywords: string
  category: string
  targetAudience: string
  asoNotes: string
  iconUrl: string
  screenshotUrls: string
  installs: string
  activeUsers: string
  averageRating: string
  reviewCount: string
  currentVersion: string
  upcomingVersion: string
  releaseNotes: string
  submissionStatus: string
  accessStatus: string
  accessNotes: string
  internalNotes: string
  clientNotes: string
  showInClientPortal: boolean
}

const emptyForm: FormState = {
  name: '', platform: 'ios', status: 'planned', appStoreUrl: '', playStoreUrl: '', packageName: '', bundleId: '', developerName: '', supportUrl: '', privacyPolicyUrl: '', websiteUrl: '',
  title: '', subtitle: '', shortDescription: '', longDescription: '', keywords: '', category: '', targetAudience: '', asoNotes: '', iconUrl: '', screenshotUrls: '',
  installs: '', activeUsers: '', averageRating: '', reviewCount: '', currentVersion: '', upcomingVersion: '', releaseNotes: '', submissionStatus: '', accessStatus: 'unknown', accessNotes: '', internalNotes: '', clientNotes: '', showInClientPortal: true,
}

function lines(value?: string[]) { return Array.isArray(value) ? value.join('\n') : '' }
function numbers(value: string) { const n = Number(value); return Number.isFinite(n) ? n : undefined }
function split(value: string) { return value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean) }

function formFromApp(app: MobileAppRecord): FormState {
  return {
    ...emptyForm,
    id: app.id,
    name: app.name ?? '',
    platform: app.platform ?? 'ios',
    status: app.status ?? 'planned',
    appStoreUrl: app.appStoreUrl ?? '',
    playStoreUrl: app.playStoreUrl ?? '',
    packageName: app.packageName ?? '',
    bundleId: app.bundleId ?? '',
    developerName: app.developerName ?? '',
    supportUrl: app.supportUrl ?? '',
    privacyPolicyUrl: app.privacyPolicyUrl ?? '',
    websiteUrl: app.websiteUrl ?? '',
    title: app.listing?.title ?? '',
    subtitle: app.listing?.subtitle ?? '',
    shortDescription: app.listing?.shortDescription ?? '',
    longDescription: app.listing?.longDescription ?? '',
    keywords: lines(app.listing?.keywords),
    category: app.listing?.category ?? '',
    targetAudience: app.listing?.targetAudience ?? '',
    asoNotes: app.listing?.asoNotes ?? '',
    iconUrl: app.assets?.iconUrl ?? '',
    screenshotUrls: lines(app.assets?.screenshotUrls),
    installs: app.analyticsSnapshot?.installs?.toString() ?? '',
    activeUsers: app.analyticsSnapshot?.activeUsers?.toString() ?? '',
    averageRating: app.analyticsSnapshot?.averageRating?.toString() ?? '',
    reviewCount: app.analyticsSnapshot?.reviewCount?.toString() ?? '',
    currentVersion: app.releaseManagement?.currentVersion ?? '',
    upcomingVersion: app.releaseManagement?.upcomingVersion ?? '',
    releaseNotes: app.releaseManagement?.releaseNotes ?? '',
    submissionStatus: app.releaseManagement?.submissionStatus ?? '',
    accessStatus: app.access?.accessStatus ?? 'unknown',
    accessNotes: app.access?.accessNotes ?? '',
    internalNotes: app.internalNotes ?? '',
    clientNotes: app.clientNotes ?? '',
    showInClientPortal: app.visibility?.showInClientPortal !== false,
  }
}

function payloadFromForm(orgId: string, form: FormState) {
  return {
    orgId,
    name: form.name,
    platform: form.platform,
    status: form.status,
    appStoreUrl: form.appStoreUrl,
    playStoreUrl: form.playStoreUrl,
    packageName: form.packageName,
    bundleId: form.bundleId,
    developerName: form.developerName,
    supportUrl: form.supportUrl,
    privacyPolicyUrl: form.privacyPolicyUrl,
    websiteUrl: form.websiteUrl,
    listing: {
      title: form.title,
      subtitle: form.subtitle,
      shortDescription: form.shortDescription,
      longDescription: form.longDescription,
      keywords: split(form.keywords),
      category: form.category,
      targetAudience: form.targetAudience,
      asoNotes: form.asoNotes,
    },
    assets: { iconUrl: form.iconUrl, screenshotUrls: split(form.screenshotUrls) },
    analyticsSnapshot: {
      installs: numbers(form.installs),
      activeUsers: numbers(form.activeUsers),
      averageRating: numbers(form.averageRating),
      reviewCount: numbers(form.reviewCount),
      lastUpdatedAt: new Date().toISOString(),
    },
    releaseManagement: {
      currentVersion: form.currentVersion,
      upcomingVersion: form.upcomingVersion,
      releaseNotes: form.releaseNotes,
      submissionStatus: form.submissionStatus,
    },
    access: { accessStatus: form.accessStatus, accessNotes: form.accessNotes },
    internalNotes: form.internalNotes,
    clientNotes: form.clientNotes,
    visibility: { showInClientPortal: form.showInClientPortal, showAnalytics: true, showReleaseNotes: true },
  }
}

export default function MobileAppsAdminPage() {
  const params = useParams()
  const slug = params.slug as string
  const [orgId, setOrgId] = useState('')
  const [orgName, setOrgName] = useState('')
  const [apps, setApps] = useState<MobileAppRecord[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const liveApps = useMemo(() => apps.filter(app => app.status === 'live').length, [apps])

  async function loadApps(id: string) {
    const res = await fetch(`/api/v1/mobile-apps?orgId=${encodeURIComponent(id)}`)
    const body = await res.json()
    setApps(Array.isArray(body.data?.apps) ? body.data.apps : [])
  }

  useEffect(() => {
    async function load() {
      const orgsRes = await fetch('/api/v1/organizations')
      const orgsBody = await orgsRes.json()
      const orgs: OrgSummary[] = Array.isArray(orgsBody.data) ? orgsBody.data : []
      const org = orgs.find(o => o.slug === slug)
      if (!org) { setLoading(false); return }
      setOrgId(org.id)
      setOrgName(org.name ?? '')
      await loadApps(org.id)
      setLoading(false)
    }
    if (slug) load()
  }, [slug])

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !form.name.trim()) return
    setSaving(true)
    setNotice('')
    const method = form.id ? 'PUT' : 'POST'
    const url = form.id ? `/api/v1/mobile-apps/${form.id}` : '/api/v1/mobile-apps'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFromForm(orgId, form)) })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setNotice(body.error ?? 'Could not save mobile app'); return }
    setForm(emptyForm)
    await loadApps(orgId)
    setNotice('Mobile app saved.')
  }

  async function archive(app: MobileAppRecord) {
    if (!app.id) return
    await fetch(`/api/v1/mobile-apps/${app.id}`, { method: 'DELETE' })
    await loadApps(orgId)
    setNotice('Mobile app archived from the client portal.')
  }

  if (loading) return <div className="pib-skeleton h-96 max-w-6xl mx-auto" />

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">{orgName} / Digital presence</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Mobile Apps</h1>
          <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">Track App Store and Play Store presence, ASO copy, release state, client-safe links, ratings and internal access notes.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="pib-card-section px-4 py-3"><p className="text-xs text-on-surface-variant">Apps</p><p className="text-xl font-bold">{apps.length}</p></div>
          <div className="pib-card-section px-4 py-3"><p className="text-xs text-on-surface-variant">Live</p><p className="text-xl font-bold">{liveApps}</p></div>
          <div className="pib-card-section px-4 py-3"><p className="text-xs text-on-surface-variant">Portal</p><p className="text-xl font-bold">{apps.filter(a => a.visibility?.showInClientPortal !== false).length}</p></div>
        </div>
      </div>

      {notice && <div className="pib-card-section p-3 text-sm text-on-surface">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_390px]">
        <div className="space-y-4">
          {apps.length === 0 && <div className="pib-card-section p-8 text-center text-on-surface-variant">No mobile apps captured yet. Add the first iOS or Android listing on the right.</div>}
          {apps.map(app => (
            <article key={app.id} className="pib-card-section p-5 space-y-4">
              <div className="flex items-start gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {app.assets?.iconUrl ? <img src={app.assets.iconUrl} alt="" className="w-14 h-14 rounded-2xl object-cover" /> : <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-container)] flex items-center justify-center"><span className="material-symbols-outlined">smartphone</span></div>}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-headline font-bold text-on-surface">{app.name}</h2>
                    <span className="pill pill-accent uppercase">{app.platform}</span>
                    <span className="pill capitalize">{app.status}</span>
                  </div>
                  <p className="text-sm text-on-surface-variant mt-1">{app.listing?.subtitle || app.listing?.shortDescription || 'No listing summary captured yet.'}</p>
                </div>
                <button type="button" onClick={() => setForm(formFromApp(app))} className="pib-btn-ghost text-sm">Edit</button>
              </div>

              <div className="grid md:grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-on-surface-variant">Version</p><p>{app.releaseManagement?.currentVersion || '—'}</p></div>
                <div><p className="text-xs text-on-surface-variant">Rating</p><p>{app.analyticsSnapshot?.averageRating ?? '—'} {app.analyticsSnapshot?.reviewCount ? `(${app.analyticsSnapshot.reviewCount})` : ''}</p></div>
                <div><p className="text-xs text-on-surface-variant">Access</p><p className="capitalize">{app.access?.accessStatus?.replace(/_/g, ' ') || 'unknown'}</p></div>
              </div>

              <div className="flex flex-wrap gap-2">
                {app.appStoreUrl && <a href={app.appStoreUrl} target="_blank" className="pib-btn-ghost text-sm">App Store</a>}
                {app.playStoreUrl && <a href={app.playStoreUrl} target="_blank" className="pib-btn-ghost text-sm">Google Play</a>}
                {app.supportUrl && <a href={app.supportUrl} target="_blank" className="pib-btn-ghost text-sm">Support</a>}
                <button type="button" onClick={() => archive(app)} className="pib-btn-ghost text-sm ml-auto">Archive</button>
              </div>
            </article>
          ))}
        </div>

        <form onSubmit={save} className="pib-card-section p-5 space-y-4 h-fit lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-headline font-bold text-on-surface">{form.id ? 'Edit app' : 'Add app'}</h2>
            {form.id && <button type="button" onClick={() => setForm(emptyForm)} className="text-xs text-on-surface-variant">New</button>}
          </div>
          <Field label="App name" value={form.name} onChange={v => update('name', v)} required />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Platform" value={form.platform} onChange={v => update('platform', v as MobileAppPlatform)} options={['ios', 'android', 'huawei', 'web', 'other']} />
            <Select label="Status" value={form.status} onChange={v => update('status', v as MobileAppStatus)} options={['planned', 'live', 'paused', 'deprecated']} />
          </div>
          <Field label="App Store URL" value={form.appStoreUrl} onChange={v => update('appStoreUrl', v)} />
          <Field label="Google Play URL" value={form.playStoreUrl} onChange={v => update('playStoreUrl', v)} />
          <div className="grid grid-cols-2 gap-3"><Field label="Bundle ID" value={form.bundleId} onChange={v => update('bundleId', v)} /><Field label="Package name" value={form.packageName} onChange={v => update('packageName', v)} /></div>
          <Field label="Listing title" value={form.title} onChange={v => update('title', v)} />
          <Field label="Subtitle / short line" value={form.subtitle} onChange={v => update('subtitle', v)} />
          <TextArea label="Short description" value={form.shortDescription} onChange={v => update('shortDescription', v)} />
          <TextArea label="Long description" value={form.longDescription} onChange={v => update('longDescription', v)} rows={4} />
          <TextArea label="ASO keywords" value={form.keywords} onChange={v => update('keywords', v)} placeholder="One per line or comma-separated" />
          <div className="grid grid-cols-2 gap-3"><Field label="Category" value={form.category} onChange={v => update('category', v)} /><Field label="Target audience" value={form.targetAudience} onChange={v => update('targetAudience', v)} /></div>
          <TextArea label="ASO notes" value={form.asoNotes} onChange={v => update('asoNotes', v)} rows={3} />
          <Field label="Icon URL" value={form.iconUrl} onChange={v => update('iconUrl', v)} />
          <TextArea label="Screenshot URLs" value={form.screenshotUrls} onChange={v => update('screenshotUrls', v)} />
          <div className="grid grid-cols-2 gap-3"><Field label="Installs" value={form.installs} onChange={v => update('installs', v)} /><Field label="Active users" value={form.activeUsers} onChange={v => update('activeUsers', v)} /></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Rating" value={form.averageRating} onChange={v => update('averageRating', v)} /><Field label="Reviews" value={form.reviewCount} onChange={v => update('reviewCount', v)} /></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Current version" value={form.currentVersion} onChange={v => update('currentVersion', v)} /><Field label="Upcoming version" value={form.upcomingVersion} onChange={v => update('upcomingVersion', v)} /></div>
          <TextArea label="Release notes" value={form.releaseNotes} onChange={v => update('releaseNotes', v)} rows={3} />
          <Select label="Access status" value={form.accessStatus} onChange={v => update('accessStatus', v)} options={['unknown', 'no_access', 'invited', 'active', 'blocked']} />
          <TextArea label="Internal access notes" value={form.accessNotes} onChange={v => update('accessNotes', v)} rows={3} />
          <TextArea label="Internal notes" value={form.internalNotes} onChange={v => update('internalNotes', v)} rows={3} />
          <TextArea label="Client-visible notes" value={form.clientNotes} onChange={v => update('clientNotes', v)} rows={3} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.showInClientPortal} onChange={e => update('showInClientPortal', e.target.checked)} /> Show in client portal</label>
          <button type="submit" disabled={saving || !form.name.trim()} className="pib-btn-primary w-full">{saving ? 'Saving…' : 'Save mobile app'}</button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><input required={required} value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></label>
}

function TextArea({ label, value, onChange, rows = 2, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows?: number; placeholder?: string }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></label>
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><select value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm">{options.map(option => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}</select></label>
}

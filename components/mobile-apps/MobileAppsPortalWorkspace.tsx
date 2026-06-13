'use client'

import { useEffect, useState } from 'react'
import type { MobileAppPlatform, MobileAppRecord } from '@/lib/mobile-apps/types'
import { MobileAppList } from '@/components/mobile-apps/MobileAppList'
import { MobileAppsWorkspaceShell } from '@/components/mobile-apps/MobileAppsWorkspaceShell'

type ProfileLinkForm = {
  appName: string
  platform: MobileAppPlatform
  label: string
  type: 'developer_account' | 'store_account' | 'analytics' | 'support' | 'other'
  accountId: string
  url: string
  notes: string
}

const initialLinkForm: ProfileLinkForm = {
  appName: '',
  platform: 'android',
  label: '',
  type: 'developer_account',
  accountId: '',
  url: '',
  notes: '',
}

function profileLinkPayload(form: ProfileLinkForm) {
  return {
    type: form.type,
    label: form.label,
    platform: form.platform,
    accountId: form.accountId,
    url: form.url,
    notes: form.notes,
  }
}

export function MobileAppsPortalWorkspace() {
  const [apps, setApps] = useState<MobileAppRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [linkingAppId, setLinkingAppId] = useState<string | null>(null)
  const [clientNotes, setClientNotes] = useState('')
  const [clientFeedback, setClientFeedback] = useState('')
  const [linkForm, setLinkForm] = useState<ProfileLinkForm>(initialLinkForm)
  const [savingLink, setSavingLink] = useState(false)
  const [notice, setNotice] = useState('')
  const [moduleDisabled, setModuleDisabled] = useState(false)

  async function load() {
    const res = await fetch('/api/v1/portal/mobile-apps')
    const body = await res.json().catch(() => ({}))
    if (!res.ok && body.moduleDisabled === true) {
      setModuleDisabled(true)
      setApps([])
      setLoading(false)
      return
    }
    setModuleDisabled(false)
    setApps(Array.isArray(body.data?.apps) ? body.data.apps : [])
    setLoading(false)
  }

  useEffect(() => {
    async function loadInitial() {
      await load()
    }
    loadInitial()
  }, [])

  function updateLinkForm<K extends keyof ProfileLinkForm>(key: K, value: ProfileLinkForm[K]) {
    setLinkForm((current) => ({ ...current, [key]: value }))
  }

  function startFeedback(app: MobileAppRecord) {
    setEditingId(app.id ?? null)
    setClientNotes(app.clientNotes ?? '')
    setClientFeedback(app.listing?.clientFeedback ?? '')
    setNotice('')
  }

  function startLink(app?: MobileAppRecord) {
    setLinkingAppId(app?.id ?? 'new')
    setLinkForm({
      ...initialLinkForm,
      appName: app?.name ?? '',
      platform: app?.platform ?? 'android',
    })
    setNotice('')
  }

  async function saveFeedback() {
    if (!editingId) return
    const res = await fetch('/api/v1/portal/mobile-apps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, clientNotes, clientFeedback }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save feedback')
      return
    }
    setEditingId(null)
    setNotice('Feedback saved for the PiB team.')
    await load()
  }

  async function saveLinkedProfile() {
    if (savingLink) return
    const isNewApp = linkingAppId === 'new'
    if (isNewApp && !linkForm.appName.trim()) {
      setNotice('Add an app name before linking a profile/account.')
      return
    }
    if (!linkForm.label.trim()) {
      setNotice('Add a profile/account name before saving.')
      return
    }
    setSavingLink(true)
    const endpointPayload = isNewApp
      ? { appName: linkForm.appName, platform: linkForm.platform, profileLink: profileLinkPayload(linkForm) }
      : { id: linkingAppId, profileLink: profileLinkPayload(linkForm) }
    const res = await fetch('/api/v1/portal/mobile-apps', {
      method: isNewApp ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpointPayload),
    })
    const body = await res.json().catch(() => ({}))
    setSavingLink(false)
    if (!res.ok) {
      setNotice(body.error ?? 'Could not link that profile/account')
      return
    }
    setLinkingAppId(null)
    setLinkForm(initialLinkForm)
    setNotice('Mobile app profile linked for PiB review.')
    await load()
  }

  const renderLinkForm = (requireAppName: boolean) => (
    <div className="mt-5 space-y-3 rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-4 text-left">
      <div>
        <p className="font-semibold text-[var(--color-pib-text)]">Connect or link a profile/account</p>
        <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
          Link an App Store Connect, Google Play, analytics, or support profile so PiB can connect the correct mobile app account to this workspace.
        </p>
      </div>
      {requireAppName ? (
        <label className="block text-sm">
          <span className="eyebrow !text-[10px]">App name</span>
          <input
            value={linkForm.appName}
            onChange={(e) => updateLinkForm('appName', e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
          />
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="eyebrow !text-[10px]">Profile/account name</span>
          <input
            value={linkForm.label}
            onChange={(e) => updateLinkForm('label', e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
          />
        </label>
        <label className="block text-sm">
          <span className="eyebrow !text-[10px]">Account/profile ID</span>
          <input
            value={linkForm.accountId}
            onChange={(e) => updateLinkForm('accountId', e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
          />
        </label>
        <label className="block text-sm">
          <span className="eyebrow !text-[10px]">Platform</span>
          <select
            value={linkForm.platform}
            onChange={(e) => updateLinkForm('platform', e.target.value as MobileAppPlatform)}
            className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-3"
          >
            <option value="android">Android / Google Play</option>
            <option value="ios">iOS / App Store</option>
            <option value="huawei">Huawei AppGallery</option>
            <option value="web">Web app</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="eyebrow !text-[10px]">Profile type</span>
          <select
            value={linkForm.type}
            onChange={(e) => updateLinkForm('type', e.target.value as ProfileLinkForm['type'])}
            className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-3"
          >
            <option value="developer_account">Developer account</option>
            <option value="store_account">Store account</option>
            <option value="analytics">Analytics</option>
            <option value="support">Support profile</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="eyebrow !text-[10px]">Profile URL</span>
        <input
          value={linkForm.url}
          onChange={(e) => updateLinkForm('url', e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
        />
      </label>
      <label className="block text-sm">
        <span className="eyebrow !text-[10px]">Notes for PiB</span>
        <textarea
          value={linkForm.notes}
          onChange={(e) => updateLinkForm('notes', e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={saveLinkedProfile} disabled={savingLink} className="pib-btn-primary text-sm disabled:opacity-60">
          {savingLink ? 'Saving linked profile...' : 'Save linked profile'}
        </button>
        <button type="button" onClick={() => setLinkingAppId(null)} className="pib-btn-ghost text-sm">
          Cancel
        </button>
      </div>
    </div>
  )

  if (moduleDisabled) {
    return (
      <MobileAppsWorkspaceShell
        apps={[]}
        surface="portal"
        eyebrow="Digital presence"
        title="Mobile apps"
        description="Mobile app review is controlled by your PiB workspace settings."
        loading={loading}
        className="p-4 sm:p-6 lg:p-8"
      >
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
          Mobile Apps is not enabled for this portal.
        </div>
      </MobileAppsWorkspaceShell>
    )
  }

  return (
    <MobileAppsWorkspaceShell
      apps={apps}
      surface="portal"
      eyebrow="Digital presence"
      title="Mobile apps"
      description="Store links, listing copy, ratings, release notes and app tasks that need client review."
      notice={notice}
      loading={loading}
      className="p-4 sm:p-6 lg:p-8"
    >
      <MobileAppList
        apps={apps}
        emptyTitle="No mobile app profile yet"
        emptyDescription="Link an App Store Connect, Google Play, analytics, or support profile so PiB can connect the correct mobile app account to this workspace."
        showListingDetails
        showReleaseNotes
        renderEmptyAction={() => (
          linkingAppId === 'new' ? renderLinkForm(true) : (
            <button type="button" onClick={() => startLink()} className="pib-btn-primary text-sm">
              Connect or link a profile/account
            </button>
          )
        )}
        renderActions={(app) => (
          <>
            {app.appStoreUrl && (
              <a href={app.appStoreUrl} target="_blank" rel="noreferrer" className="pib-btn-primary text-sm">
                Open App Store
              </a>
            )}
            {app.playStoreUrl && (
              <a href={app.playStoreUrl} target="_blank" rel="noreferrer" className="pib-btn-primary text-sm">
                Open Google Play
              </a>
            )}
            {app.supportUrl && (
              <a href={app.supportUrl} target="_blank" rel="noreferrer" className="pib-btn-ghost text-sm">
                Support
              </a>
            )}
            <button type="button" onClick={() => startLink(app)} className="pib-btn-ghost text-sm">
              Connect or link a profile/account
            </button>
          </>
        )}
        renderFooter={(app) => (
          <>
            {app.profileLinks?.length ? (
              <section className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                <p className="eyebrow !text-[10px]">Linked profiles/accounts</p>
                <div className="mt-2 space-y-2">
                  {app.profileLinks.map((link) => (
                    <div key={link.id ?? `${link.type}-${link.label}`} className="rounded-xl bg-white/[0.03] p-3 text-sm">
                      <p className="font-semibold text-[var(--color-pib-text)]">{link.label}</p>
                      <p className="mt-1 text-xs capitalize text-[var(--color-pib-text-muted)]">
                        {link.type.replace(/_/g, ' ')} · {link.status}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {linkingAppId === app.id ? renderLinkForm(false) : null}
            {app.clientNotes && <p className="rounded-2xl bg-white/[0.04] p-3 text-sm">{app.clientNotes}</p>}
            {editingId === app.id ? (
              <div className="space-y-3 rounded-2xl border border-[var(--color-pib-line)] p-3">
                <label className="block text-sm">
                  <span className="eyebrow !text-[10px]">Notes for PiB</span>
                  <textarea
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
                  />
                </label>
                <label className="block text-sm">
                  <span className="eyebrow !text-[10px]">Listing feedback</span>
                  <textarea
                    value={clientFeedback}
                    onChange={(e) => setClientFeedback(e.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3"
                  />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={saveFeedback} className="pib-btn-primary text-sm">
                    Save feedback
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="pib-btn-ghost text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => startFeedback(app)} className="pib-btn-ghost text-sm">
                Leave feedback / request changes
              </button>
            )}
          </>
        )}
      />
    </MobileAppsWorkspaceShell>
  )
}

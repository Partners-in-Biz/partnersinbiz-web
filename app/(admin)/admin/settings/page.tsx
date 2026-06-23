// app/(admin)/admin/settings/page.tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'
import { copyToClipboard } from '@/lib/utils/clipboard'
import { PushNotificationsToggle } from '@/components/pwa/PushNotificationsToggle'
import { SettingsPlatformConfig } from '@/components/admin/governance/SettingsPlatformConfig'

interface SessionInfo {
  email?: string | null
  role?: string
  isSuperAdmin?: boolean
}

interface ClientOrgSummary {
  id: string
  name: string
  type?: string
  status?: string
}

interface NotificationChannels {
  inApp: boolean
  push: boolean
  email: boolean
}

const DEFAULT_CHANNELS: NotificationChannels = { inApp: true, push: true, email: true }

function normaliseChannels(value?: Partial<NotificationChannels>): NotificationChannels {
  return {
    inApp: typeof value?.inApp === 'boolean' ? value.inApp : DEFAULT_CHANNELS.inApp,
    push: typeof value?.push === 'boolean' ? value.push : DEFAULT_CHANNELS.push,
    email: typeof value?.email === 'boolean' ? value.email : DEFAULT_CHANNELS.email,
  }
}

function ChannelSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        checked
          ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)]/80'
          : 'border-[var(--color-card-border)] bg-[var(--color-surface-container)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  )
}

const PLATFORM_ITEMS = [
  { label: 'Platform Users', desc: 'Manage admin and operator user accounts', href: '/admin/platform-users', superAdminOnly: true },
  { label: 'Platform Members', desc: 'Audit portal access records and linked organisation accounts', href: '/admin/platform-members', superAdminOnly: true },
  { label: 'Communications', desc: 'Inspect operator support queues, routing, and customer messaging operations', href: '/admin/support' },
  { label: 'API Keys', desc: 'Manage API keys for AI agents and integrations', href: '/admin/settings/api-keys' },
]

export default function SettingsPage() {
  const { selectedOrgId, orgName } = useOrg()
  const [copied, setCopied] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [clientOrgs, setClientOrgs] = useState<ClientOrgSummary[]>([])
  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, NotificationChannels>>({})
  const [notificationLoading, setNotificationLoading] = useState(true)
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null)
  const [notificationFeedback, setNotificationFeedback] = useState<string | null>(null)
  const [notificationError, setNotificationError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((res) => (res.ok ? res.json() : null))
      .then((session: SessionInfo | null) => {
        if (!cancelled) {
          setSession(session)
          setIsSuperAdmin(Boolean(session?.isSuperAdmin))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null)
          setIsSuperAdmin(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadNotificationPreferences() {
      setNotificationLoading(true)
      setNotificationError(null)
      try {
        const orgRes = await fetch('/api/v1/organizations')
        const orgBody = orgRes.ok ? await orgRes.json() : { data: [] }
        const clients = ((orgBody.data ?? []) as ClientOrgSummary[]).filter((org) => org.type !== 'platform_owner')
        if (cancelled) return
        setClientOrgs(clients)

        const preferenceEntries = await Promise.all(
          clients.map(async (org) => {
            try {
              const prefRes = await fetch(`/api/v1/admin/notification-preferences?orgId=${encodeURIComponent(org.id)}`)
              if (!prefRes.ok) return [org.id, DEFAULT_CHANNELS] as const
              const prefBody = await prefRes.json()
              return [org.id, normaliseChannels(prefBody.data?.preference?.channels)] as const
            } catch {
              return [org.id, DEFAULT_CHANNELS] as const
            }
          }),
        )
        if (!cancelled) setNotificationPrefs(Object.fromEntries(preferenceEntries))
      } catch {
        if (!cancelled) setNotificationError('Could not load organisation notification preferences.')
      } finally {
        if (!cancelled) setNotificationLoading(false)
      }
    }

    loadNotificationPreferences()
    return () => {
      cancelled = true
    }
  }, [])

  async function saveNotificationPreference(org: ClientOrgSummary, channels: NotificationChannels) {
    setSavingOrgId(org.id)
    setNotificationFeedback(null)
    setNotificationError(null)
    const previous = notificationPrefs[org.id] ?? DEFAULT_CHANNELS
    setNotificationPrefs((current) => ({ ...current, [org.id]: channels }))

    try {
      const res = await fetch(`/api/v1/admin/notification-preferences?orgId=${encodeURIComponent(org.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      setNotificationPrefs((current) => ({
        ...current,
        [org.id]: normaliseChannels(body.data?.preference?.channels ?? channels),
      }))
      setNotificationFeedback(`Saved ${org.name} preferences`)
    } catch {
      setNotificationPrefs((current) => ({ ...current, [org.id]: previous }))
      setNotificationError(`Could not save ${org.name} preferences.`)
    } finally {
      setSavingOrgId(null)
    }
  }

  function toggleNotificationChannel(org: ClientOrgSummary, channel: keyof NotificationChannels) {
    const current = notificationPrefs[org.id] ?? DEFAULT_CHANNELS
    saveNotificationPreference(org, { ...current, [channel]: !current[channel] })
  }

  function copyOrgId() {
    if (!selectedOrgId) return
    copyToClipboard(selectedOrgId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Settings</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Platform Settings</h1>
      </div>

      {/* Platform configuration */}
      <SettingsPlatformConfig canEdit={isSuperAdmin} />

      {/* Organisation */}
      {selectedOrgId && (
        <div className="pib-card-section">
          <div className="pib-card-section-header">
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Organisation
            </span>
          </div>
          {orgName && (
            <div className="pib-card-section-row">
              <span className="text-sm text-on-surface-variant">Name</span>
              <span className="text-sm text-on-surface font-medium">{orgName}</span>
            </div>
          )}
          <div className="pib-card-section-row">
            <span className="text-sm text-on-surface-variant">Org ID</span>
            <span className="flex items-center gap-2">
              <code className="font-mono text-xs text-on-surface bg-[var(--color-surface-container)] px-2 py-1 rounded select-all">
                {selectedOrgId}
              </code>
              <button
                onClick={copyOrgId}
                className="text-xs text-on-surface-variant hover:text-on-surface transition-colors px-2 py-1 rounded hover:bg-[var(--color-surface-container)]"
                title="Copy Org ID"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </span>
          </div>
          <div className="px-4 pb-3">
            <p className="text-[11px] text-on-surface-variant/60">
              Use this ID when configuring AI agents or API integrations for this organisation.
            </p>
          </div>
        </div>
      )}

      {/* Platform */}
      <div className="pib-card space-y-2">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Platform</p>
        {PLATFORM_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin).map(item => (
          <Link key={item.href} href={item.href} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--color-row-hover)] transition-colors">
            <div>
              <p className="text-sm font-medium text-on-surface">{item.label}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
            </div>
            <span style={{ color: 'var(--color-accent-v2)' }}>→</span>
          </Link>
        ))}
      </div>

      {/* Account */}
      <div className="pib-card-section">
        <div className="pib-card-section-header">
          <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Account
          </span>
        </div>
        <div className="pib-card-section-row">
          <span className="text-sm text-on-surface-variant">Email</span>
          <span className="text-sm text-on-surface font-medium">
            {session?.email ?? 'Signed-in user'}
          </span>
        </div>
        <div className="pib-card-section-row">
          <span className="text-sm text-on-surface-variant">Role</span>
          <span className="text-[10px] font-label uppercase tracking-widest px-2.5 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
            {session?.role ?? 'Admin'}
          </span>
        </div>
        <Link href="/admin/settings#integrations" className="flex items-center justify-between px-4 py-3 hover:bg-[var(--color-row-hover)] transition-colors">
          <div>
            <p className="text-sm font-medium text-on-surface">Internal email operations</p>
            <p className="text-xs text-on-surface-variant mt-0.5">Review the admin integration status for email services before changing mailbox configuration.</p>
          </div>
          <span style={{ color: 'var(--color-accent-v2)' }}>→</span>
        </Link>
      </div>

      {/* Notification preferences */}
      <div className="pib-card-section">
        <div className="pib-card-section-header">
          <div>
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Device push notifications
            </span>
            <p className="text-xs text-on-surface-variant mt-1 normal-case tracking-normal">
              Enable browser push delivery on this device before choosing which organisation-alert lanes can use push.
            </p>
          </div>
        </div>
        <div className="px-4 py-3">
          <PushNotificationsToggle />
        </div>
      </div>

      <div className="pib-card-section">
        <div className="pib-card-section-header">
          <div>
            <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              Organisation alert preferences
            </span>
            <p className="text-xs text-on-surface-variant mt-1 normal-case tracking-normal">
              Choose which admin organisation alert lanes can send you in-app/push alerts and email notifications.
            </p>
          </div>
        </div>
        {notificationFeedback && (
          <div className="mx-4 mt-3 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">
            {notificationFeedback}
          </div>
        )}
        {notificationError && (
          <div className="mx-4 mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {notificationError}
          </div>
        )}
        <div className="px-4 py-3">
          {notificationLoading ? (
            <p className="text-sm text-on-surface-variant">Loading organisation alert settings…</p>
          ) : clientOrgs.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No organisations are available for notification preferences.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)]">
              <div className="grid grid-cols-12 gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-4 py-2">
                <span className="col-span-6 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Organisation</span>
                <span className="col-span-3 text-center text-[10px] font-label uppercase tracking-widest text-on-surface-variant">In-app / push</span>
                <span className="col-span-3 text-center text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Email</span>
              </div>
              {clientOrgs.map((org) => {
                const channels = notificationPrefs[org.id] ?? DEFAULT_CHANNELS
                const disabled = savingOrgId === org.id
                return (
                  <div key={org.id} className="grid grid-cols-12 gap-3 items-center border-b border-[var(--color-card-border)] px-4 py-3 last:border-b-0">
                    <div className="col-span-6 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{org.name}</p>
                      <p className="text-[11px] text-on-surface-variant">{disabled ? 'Saving…' : 'Acceptance, approval, billing, CRM and system alerts'}</p>
                    </div>
                    <div className="col-span-3 flex justify-center">
                      <ChannelSwitch
                        checked={channels.inApp && channels.push}
                        disabled={disabled}
                        label={`In-app and push notifications for ${org.name}`}
                        onChange={() => {
                          const nextEnabled = !(channels.inApp && channels.push)
                          saveNotificationPreference(org, { ...channels, inApp: nextEnabled, push: nextEnabled })
                        }}
                      />
                    </div>
                    <div className="col-span-3 flex justify-center">
                      <ChannelSwitch
                        checked={channels.email}
                        disabled={disabled}
                        label={`Email notifications for ${org.name}`}
                        onChange={() => toggleNotificationChannel(org, 'email')}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Integrations */}
      <div id="integrations" className="pib-card-section">
        <div className="pib-card-section-header">
          <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Integrations
          </span>
        </div>
        <div className="pib-card-section-row">
          <span className="text-sm text-on-surface-variant">Firebase / Firestore</span>
          <span className="flex items-center gap-2 text-sm text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            Connected
          </span>
        </div>
        <div className="pib-card-section-row">
          <span className="text-sm text-on-surface-variant">Resend Email</span>
          <span className="text-sm text-on-surface-variant">
            Check Vercel env vars
          </span>
        </div>
      </div>

      {/* API Access */}
      <div className="pib-card-section">
        <div className="pib-card-section-header">
          <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            API Access
          </span>
        </div>
        <div className="pib-card-section-row">
          <span className="text-sm text-on-surface-variant">AI API Key</span>
          <span className="text-sm text-on-surface-variant text-right">
            Set via <code className="font-mono text-xs text-on-surface bg-[var(--color-surface-container)] px-1.5 py-0.5 rounded">ADMIN_EMAIL</code> env var
          </span>
        </div>
        <div className="pib-card-section-row">
          <span className="text-sm text-on-surface-variant">Session Cookie</span>
          <span className="text-sm text-on-surface-variant text-right">
            14 days — configurable via{' '}
            <code className="font-mono text-xs text-on-surface bg-[var(--color-surface-container)] px-1.5 py-0.5 rounded">
              SESSION_EXPIRY_DAYS
            </code>
          </span>
        </div>
      </div>

      {/* Billing & Revenue */}
      <div className="pib-card space-y-1">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Billing &amp; Revenue</p>
        {[
          { icon: 'payments', title: 'Plans & Pricing', desc: 'Manage subscription plans and pricing tiers. Plans: Starter, Growth, Scale, Enterprise.', cta: 'View plans' },
          { icon: 'confirmation_number', title: 'Coupon / Discount Codes', desc: 'Manage promotional discount codes.', cta: 'Configure' },
          { icon: 'trending_up', title: 'Revenue & MRR', desc: 'Monthly recurring revenue dashboard. Connect billing analytics to view live MRR, churn, and ARR.', cta: 'View dashboard' },
          { icon: 'account_balance', title: 'EFT Payment Queue', desc: 'Verify and process incoming EFT bank transfers.', cta: 'Open queue' },
          { icon: 'hourglass_top', title: 'Trial Conversion', desc: 'Manage organisations on trial plans and track conversion rates.', cta: 'View trials' },
          { icon: 'person_remove', title: 'Churn Analysis', desc: 'Track and analyse subscription churn by cohort.', cta: 'View churn' },
          { icon: 'autorenew', title: 'Billing Dunning', desc: 'Automated payment retry sequences for failed billing.', cta: 'Configure' },
          { icon: 'group_add', title: 'Referral Programme', desc: 'Manage client referral incentives and track referral performance.', cta: 'Configure' },
          { icon: 'hub', title: 'Stripe Connect', desc: 'Marketplace payment routing configuration.', cta: 'Configure' },
        ].map(item => (
          <div key={item.title} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--color-row-hover)] transition-colors">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] mt-0.5" style={{ color: 'var(--color-accent-v2)' }}>{item.icon}</span>
              <div>
                <p className="text-sm font-medium text-on-surface">{item.title}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
              </div>
            </div>
            <button type="button" className="shrink-0 ml-4 text-xs text-on-surface-variant hover:text-on-surface px-2 py-1 rounded hover:bg-[var(--color-surface-container)] transition-colors">{item.cta} →</button>
          </div>
        ))}
      </div>

      {/* Platform Communications */}
      <div className="pib-card space-y-1">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Platform Communications</p>
        {[
          { icon: 'campaign', title: 'Platform Broadcast', desc: 'Send platform-wide broadcasts to all active organisations.', href: '/admin/settings/broadcast' },
          { icon: 'notifications', title: 'Announcements', desc: 'Publish in-app announcement banners for all users.', href: '/admin/announcements' },
          { icon: 'history', title: 'Changelog', desc: 'Manage the public product changelog and release notes.', href: '/admin/changelog' },
        ].map(item => (
          <Link key={item.title} href={item.href} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--color-row-hover)] transition-colors">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] mt-0.5" style={{ color: 'var(--color-accent-v2)' }}>{item.icon}</span>
              <div>
                <p className="text-sm font-medium text-on-surface">{item.title}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
              </div>
            </div>
            <span style={{ color: 'var(--color-accent-v2)' }}>→</span>
          </Link>
        ))}
      </div>

      {/* Legal & Compliance */}
      <div className="pib-card space-y-1">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Legal &amp; Compliance</p>
        {[
          { icon: 'gavel', title: 'Legal Documents', desc: 'Terms of service, privacy policy and legal document management.', href: '/admin/legal' },
          { icon: 'privacy_tip', title: 'GDPR Compliance', desc: 'Data processing agreements, right-to-erasure workflows, and GDPR reporting.', href: '/admin/legal/gdpr' },
          { icon: 'assignment_turned_in', title: 'Automated Compliance Reporting', desc: 'Scheduled compliance reports for data protection audits.', href: '/admin/legal/compliance' },
          { icon: 'shield', title: 'Content Moderation', desc: 'Review flagged content and moderation queues.', href: '/admin/moderation' },
        ].map(item => (
          <Link key={item.title} href={item.href} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--color-row-hover)] transition-colors">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] mt-0.5" style={{ color: 'var(--color-accent-v2)' }}>{item.icon}</span>
              <div>
                <p className="text-sm font-medium text-on-surface">{item.title}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
              </div>
            </div>
            <span style={{ color: 'var(--color-accent-v2)' }}>→</span>
          </Link>
        ))}
      </div>

      {/* Infrastructure & Config */}
      <div className="pib-card space-y-1">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Infrastructure &amp; Config</p>
        {[
          { icon: 'admin_panel_settings', title: 'Admin Users', desc: 'Manage admin accounts, roles, and access.', href: '/admin/settings/admins' },
          { icon: 'dns', title: 'White-Label Domains', desc: 'Configure custom domains for client portal white-labelling.', href: '/admin/domains' },
          { icon: 'lock', title: 'SSL Certificate Management', desc: 'Automated SSL provisioning for custom domains.', href: '/admin/domains/ssl' },
          { icon: 'notifications_active', title: 'Admin Alerts', desc: 'Slack/webhook notifications for critical platform events.', href: '/admin/settings/alerts' },
          { icon: 'build_circle', title: 'Maintenance Mode', desc: 'Schedule and activate platform maintenance windows.', href: '/admin/settings/maintenance' },
          { icon: 'science', title: 'A/B Testing', desc: 'Manage A/B tests for public landing pages.', href: '/admin/ab-tests' },
          { icon: 'upload_file', title: 'Admin CSV Import Tools', desc: 'Bulk data import for organisations, contacts, and users.', href: '/admin/tools/import' },
        ].map(item => (
          <Link key={item.title} href={item.href} className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--color-row-hover)] transition-colors">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] mt-0.5" style={{ color: 'var(--color-accent-v2)' }}>{item.icon}</span>
              <div>
                <p className="text-sm font-medium text-on-surface">{item.title}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{item.desc}</p>
              </div>
            </div>
            <span style={{ color: 'var(--color-accent-v2)' }}>→</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

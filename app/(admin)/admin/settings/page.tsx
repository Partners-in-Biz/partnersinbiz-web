// app/(admin)/admin/settings/page.tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface SessionInfo {
  email?: string | null
  role?: string
  isSuperAdmin?: boolean
}

const PLATFORM_ITEMS = [
  { label: 'Platform Users', desc: 'Manage admin and operator user accounts', href: '/admin/platform-users', superAdminOnly: true },
  { label: 'Platform Members', desc: 'View client logins and linked client accounts', href: '/admin/platform-members', superAdminOnly: true },
  { label: 'API Keys', desc: 'Manage API keys for AI agents and integrations', href: '/admin/settings/api-keys' },
]

export default function SettingsPage() {
  const { selectedOrgId, orgName } = useOrg()
  const [copied, setCopied] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [session, setSession] = useState<SessionInfo | null>(null)

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
        <Link href="/admin/email/mailbox" className="flex items-center justify-between px-4 py-3 hover:bg-[var(--color-row-hover)] transition-colors">
          <div>
            <p className="text-sm font-medium text-on-surface">Internal mailbox</p>
            <p className="text-xs text-on-surface-variant mt-0.5">Link Gmail or SMTP/IMAP and send mail from your admin profile.</p>
          </div>
          <span style={{ color: 'var(--color-accent-v2)' }}>→</span>
        </Link>
      </div>

      {/* Integrations */}
      <div className="pib-card-section">
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
    </div>
  )
}

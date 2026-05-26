'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface PortalViewSwitchProps {
  orgId: string
  collapsed?: boolean
  compact?: boolean
}

export function PortalViewSwitch({ orgId, collapsed = false, compact = false }: PortalViewSwitchProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function switchToPortal() {
    if (!orgId || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          typeof body?.error === 'string'
            ? body.error
            : 'Add this admin as a team member before opening portal view.',
        )
      }
      router.push('/portal/dashboard')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch to portal view.')
    } finally {
      setLoading(false)
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={switchToPortal}
        disabled={loading}
        title="Switch to portal view"
        className="hidden md:flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[18px]">web_asset</span>
        <span className="hidden lg:inline">{loading ? 'Opening...' : 'Portal'}</span>
      </button>
    )
  }

  return (
    <div className={collapsed ? 'px-2 py-2' : 'px-3 py-3'}>
      <button
        type="button"
        onClick={switchToPortal}
        disabled={loading}
        title="Switch to portal view"
        className={[
          'w-full flex items-center rounded-lg text-sm transition-all duration-150 disabled:opacity-60',
          collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2',
          'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.03]',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[20px] shrink-0 opacity-70">web_asset</span>
        {!collapsed && <span className="font-medium">{loading ? 'Opening portal...' : 'Portal view'}</span>}
      </button>
      {!collapsed && error && (
        <p className="mt-2 px-1 text-[11px] leading-snug text-red-300">{error}</p>
      )}
    </div>
  )
}

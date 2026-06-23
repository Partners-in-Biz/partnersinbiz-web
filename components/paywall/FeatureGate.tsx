'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// ── Feature definitions ───────────────────────────────────────────────────

/**
 * Map of feature slug → human-readable display name.
 * Extend as new gated features are added.
 */
const FEATURE_LABELS: Record<string, string> = {
  seo: 'SEO Sprints',
  ads: 'Ad Campaigns',
  analytics: 'Analytics',
  advanced_analytics: 'Advanced Analytics',
  geo_seo: 'Geo SEO',
  email_analytics: 'Email Analytics',
}

/**
 * Features that are available on each plan.
 * A feature is ENABLED if the org's plan is in the allowed set.
 * An empty set means the feature is available on all plans.
 * Omitting a feature means it is always available (no gate).
 *
 * Plans in use: 'starter', 'growth', 'scale', 'enterprise'
 */
const FEATURE_PLAN_REQUIREMENTS: Record<string, string[]> = {
  // No entry = always available (no gate needed)
  seo: ['growth', 'scale', 'enterprise'],
  ads: ['growth', 'scale', 'enterprise'],
  analytics: ['growth', 'scale', 'enterprise'],
  advanced_analytics: ['scale', 'enterprise'],
  geo_seo: ['scale', 'enterprise'],
  email_analytics: ['growth', 'scale', 'enterprise'],
}

// ── Module-level fetch cache ──────────────────────────────────────────────

interface OrgPortalData {
  plan: string
  modulePolicies: Record<string, unknown>
}

const cache: {
  data?: OrgPortalData
  promise?: Promise<OrgPortalData | null>
} = {}

async function fetchOrgData(): Promise<OrgPortalData | null> {
  if (cache.data) return cache.data
  if (!cache.promise) {
    cache.promise = fetch('/api/v1/portal/org', { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) return null
        const body = await res.json() as { org?: { plan?: string; modulePolicies?: Record<string, unknown> } }
        const org = body?.org
        if (!org) return null
        const data: OrgPortalData = {
          plan: typeof org.plan === 'string' ? org.plan : 'starter',
          modulePolicies: org.modulePolicies ?? {},
        }
        cache.data = data
        return data
      })
      .catch(() => null)
  }
  return cache.promise
}

// ── Feature access check ──────────────────────────────────────────────────

function isFeatureEnabled(feature: string, plan: string): boolean {
  const required = FEATURE_PLAN_REQUIREMENTS[feature]
  // No requirement defined → always available
  if (!required) return true
  // Empty array → available on all plans
  if (required.length === 0) return true
  return required.includes(plan)
}

// ── Component ─────────────────────────────────────────────────────────────

export interface FeatureGateProps {
  /** Feature slug, e.g. 'seo', 'ads', 'analytics' */
  feature: string
  children: React.ReactNode
  /** Where the "Upgrade plan" button links. Defaults to /portal/invoicing */
  upgradeHref?: string
}

/**
 * FeatureGate wraps content that requires a specific plan tier.
 *
 * - On server render and while loading: renders children optimistically.
 * - After hydration: fetches org plan from /api/v1/portal/org (shared cache).
 * - If the feature is locked: replaces children with a blurred upgrade prompt.
 */
export function FeatureGate({ feature, children, upgradeHref }: FeatureGateProps) {
  // null = loading / unknown, true = enabled, false = locked
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOrgData().then((data) => {
      if (cancelled) return
      if (!data) {
        // Could not determine — default to showing feature (fail open)
        setEnabled(true)
        return
      }
      setEnabled(isFeatureEnabled(feature, data.plan))
    })
    return () => { cancelled = true }
  }, [feature])

  // Optimistic: render children while loading or enabled
  if (enabled !== false) return <>{children}</>

  const label = FEATURE_LABELS[feature] ?? feature
  const href = upgradeHref ?? '/portal/invoicing'

  return (
    <div className="relative min-h-[320px]">
      {/* Blurred dimmed children underneath */}
      <div
        aria-hidden="true"
        style={{
          filter: 'blur(6px)',
          opacity: 0.35,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {children}
      </div>

      {/* Upgrade card overlay */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ zIndex: 10 }}
      >
        <div
          className="flex flex-col items-center gap-4 rounded-2xl p-8 text-center shadow-xl"
          style={{
            background: 'var(--color-pib-surface-2)',
            border: '1px solid var(--color-pib-line-strong)',
            maxWidth: '380px',
            width: '100%',
          }}
        >
          {/* Lock icon */}
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '40px',
              color: 'var(--color-pib-accent)',
            }}
          >
            lock
          </span>

          {/* Heading */}
          <h2
            className="text-base font-headline font-semibold"
            style={{ color: 'var(--color-pib-text)' }}
          >
            This feature isn&apos;t included in your plan
          </h2>

          {/* Body */}
          <p
            className="text-sm leading-relaxed"
            style={{ color: 'var(--color-pib-text-muted)' }}
          >
            Upgrade your Partners in Biz plan to access{' '}
            <strong style={{ color: 'var(--color-pib-text)' }}>{label}</strong>.
          </p>

          {/* CTA */}
          <Link
            href={href}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-label font-semibold transition-colors"
            style={{
              background: 'var(--color-pib-accent)',
              color: 'var(--color-pib-ink)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              arrow_upward
            </span>
            Upgrade plan
          </Link>
        </div>
      </div>
    </div>
  )
}

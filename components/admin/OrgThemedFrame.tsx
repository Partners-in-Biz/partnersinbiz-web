'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { PreviewBrand } from '@/components/campaign-preview/types'
import type { Organization } from '@/lib/organizations/types'
import {
  toPreviewBrand,
  type BrandColorsLike,
} from '@/lib/organizations/toPreviewBrand'

interface OrgThemedFrameValue {
  org: Organization | null
  brand: PreviewBrand | undefined
  brandColors: BrandColorsLike | undefined
  loading: boolean
}

const Ctx = createContext<OrgThemedFrameValue>({
  org: null,
  brand: undefined,
  brandColors: undefined,
  loading: true,
})

export function useOrgBrand(): OrgThemedFrameValue {
  return useContext(Ctx)
}

/** CSS vars for client brand, only inside preview surfaces (never chrome). */
export function orgPreviewBrandVars(
  brandColors: BrandColorsLike | undefined,
): CSSProperties {
  if (!brandColors) return {}
  return {
    '--org-bg': brandColors.background ?? 'var(--sc-canvas)',
    '--org-surface': brandColors.surface ?? 'var(--sc-surface)',
    '--org-accent':
      brandColors.accent ?? brandColors.primary ?? 'var(--sc-accent)',
    '--org-accent-soft':
      brandColors.accent ?? brandColors.primary ?? 'var(--sc-accent)',
    '--org-text': brandColors.text ?? 'var(--sc-ink)',
    '--org-text-muted': brandColors.textMuted ?? 'var(--sc-ink-soft)',
    '--org-border': brandColors.border ?? 'var(--sc-line)',
  } as CSSProperties
}

/**
 * Scopes client brand CSS vars to a preview subtree only.
 * Do not wrap page chrome, shells, or toolbars with this.
 */
export function OrgPreviewBrandScope({
  brandColors,
  children,
  className = '',
}: {
  brandColors?: BrandColorsLike
  children: ReactNode
  className?: string
}) {
  const { brandColors: ctxColors } = useOrgBrand()
  const colors = brandColors ?? ctxColors
  return (
    <div className={className} style={orgPreviewBrandVars(colors)} data-org-preview-brand="">
      {children}
    </div>
  )
}

/**
 * Loads org brand into context for previews. Does not paint client brand
 * onto admin chrome; Studio tokens own the shell and page frame.
 */
export function OrgThemedFrame({
  orgId,
  children,
  className = '',
}: {
  orgId: string | null
  children: ReactNode
  className?: string
}) {
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) {
      setOrg(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/v1/organizations/${orgId}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        setOrg((body?.data ?? null) as Organization | null)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const brandColors = (org?.settings?.brandColors ?? undefined) as
    | BrandColorsLike
    | undefined
  const brand = useMemo(
    () => toPreviewBrand(brandColors, org?.brandProfile, org?.name),
    [brandColors, org?.brandProfile, org?.name],
  )

  return (
    <Ctx.Provider value={{ org, brand, brandColors, loading }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  )
}

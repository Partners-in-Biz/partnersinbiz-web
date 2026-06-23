'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface FeatureFlags {
  show_ai_features: boolean
  show_creative_canvas: boolean
  enable_social_listening: boolean
  show_whatsapp: boolean
}

export type FeatureFlagKey = keyof FeatureFlags

const DEFAULT_FLAGS: FeatureFlags = {
  show_ai_features: true,
  show_creative_canvas: true,
  enable_social_listening: false,
  show_whatsapp: false,
}

interface FeatureFlagsContextValue {
  flags: FeatureFlags
  loading: boolean
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: DEFAULT_FLAGS,
  loading: true,
})

function coerce(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function FeatureFlagsProvider({
  orgId,
  children,
}: {
  orgId: string
  children: ReactNode
}) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const url = orgId
      ? `/api/v1/org/feature-flags?orgId=${encodeURIComponent(orgId)}`
      : '/api/v1/org/feature-flags'
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return
        const raw = (body?.data ?? body)?.flags as Partial<FeatureFlags> | undefined
        if (raw) {
          setFlags({
            show_ai_features: coerce(raw.show_ai_features, DEFAULT_FLAGS.show_ai_features),
            show_creative_canvas: coerce(raw.show_creative_canvas, DEFAULT_FLAGS.show_creative_canvas),
            enable_social_listening: coerce(raw.enable_social_listening, DEFAULT_FLAGS.enable_social_listening),
            show_whatsapp: coerce(raw.show_whatsapp, DEFAULT_FLAGS.show_whatsapp),
          })
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return (
    <FeatureFlagsContext.Provider value={{ flags, loading }}>
      {children}
    </FeatureFlagsContext.Provider>
  )
}

/** Returns the boolean value of a single feature flag (default-on/off per server defaults). */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useContext(FeatureFlagsContext).flags[key]
}

/** Returns the whole flag set plus loading state. */
export function useFeatureFlags(): FeatureFlagsContextValue {
  return useContext(FeatureFlagsContext)
}

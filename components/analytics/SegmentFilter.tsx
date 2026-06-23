'use client'

import { useEffect, useState } from 'react'

export interface SegmentValue {
  visitorType: 'all' | 'new' | 'returning'
  device: '' | 'mobile' | 'tablet' | 'desktop'
  source: string
  country: string
  crmSegmentId: string
}

export const EMPTY_SEGMENT: SegmentValue = {
  visitorType: 'all',
  device: '',
  source: '',
  country: '',
  crmSegmentId: '',
}

interface CrmSegmentOption {
  id: string
  name: string
}

/** Serialise a SegmentValue into query params (only non-empty filters). */
export function segmentToParams(s: SegmentValue): Record<string, string> {
  const p: Record<string, string> = {}
  if (s.visitorType && s.visitorType !== 'all') p.visitorType = s.visitorType
  if (s.device) p.device = s.device
  if (s.source) p.source = s.source
  if (s.country) p.country = s.country
  if (s.crmSegmentId) p.crmSegmentId = s.crmSegmentId
  return p
}

export function isSegmentActive(s: SegmentValue): boolean {
  return Object.keys(segmentToParams(s)).length > 0
}

const STORAGE_KEY = 'pib_analytics_segment'

export function loadPersistedSegment(): SegmentValue {
  if (typeof localStorage === 'undefined') return EMPTY_SEGMENT
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...EMPTY_SEGMENT, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return EMPTY_SEGMENT
}

/**
 * Segment filter dropdown with persistence (US-143). Loads the org's CRM
 * dynamic segments so an analytics view can be filtered to a CRM audience.
 */
export function SegmentFilter({
  value,
  onChange,
  orgId,
  className = '',
}: {
  value: SegmentValue
  onChange: (v: SegmentValue) => void
  orgId?: string | null
  className?: string
}) {
  const [crmSegments, setCrmSegments] = useState<CrmSegmentOption[]>([])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* ignore */ }
  }, [value])

  useEffect(() => {
    if (!orgId) { setCrmSegments([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/crm/segments?orgId=${encodeURIComponent(orgId)}`)
        if (!res.ok) return
        const body = await res.json()
        const list = (body.data ?? body.segments ?? []) as CrmSegmentOption[]
        if (!cancelled) setCrmSegments(list)
      } catch { /* CRM segments optional */ }
    })()
    return () => { cancelled = true }
  }, [orgId])

  const active = isSegmentActive(value)

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <div>
        <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Visitor</label>
        <select
          value={value.visitorType}
          onChange={e => onChange({ ...value, visitorType: e.target.value as SegmentValue['visitorType'] })}
          className="pib-input text-xs"
        >
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="returning">Returning</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Device</label>
        <select
          value={value.device}
          onChange={e => onChange({ ...value, device: e.target.value as SegmentValue['device'] })}
          className="pib-input text-xs"
        >
          <option value="">Any</option>
          <option value="desktop">Desktop</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Source</label>
        <input
          type="text"
          value={value.source}
          onChange={e => onChange({ ...value, source: e.target.value })}
          placeholder="utm source"
          className="pib-input text-xs w-28"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Country</label>
        <input
          type="text"
          value={value.country}
          onChange={e => onChange({ ...value, country: e.target.value.toUpperCase() })}
          placeholder="ZA"
          maxLength={2}
          className="pib-input text-xs w-16"
        />
      </div>
      {crmSegments.length > 0 && (
        <div>
          <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">CRM Segment</label>
          <select
            value={value.crmSegmentId}
            onChange={e => onChange({ ...value, crmSegmentId: e.target.value })}
            className="pib-input text-xs"
          >
            <option value="">None</option>
            {crmSegments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_SEGMENT)}
          className="px-2.5 py-1.5 rounded text-xs font-medium text-red-400 hover:bg-red-400/10"
        >
          Clear
        </button>
      )}
    </div>
  )
}

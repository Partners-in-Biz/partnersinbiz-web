'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Property } from '@/lib/properties/types'

interface OrgOption {
  id: string
  name: string
}

interface AnalyticsPropertyPickerProps {
  value: string
  onChange: (propertyId: string) => void
  disabled?: boolean
  className?: string
}

export function AnalyticsPropertyPicker({
  value,
  onChange,
  disabled = false,
  className = '',
}: AnalyticsPropertyPickerProps) {
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgId, setOrgId] = useState('')
  const [properties, setProperties] = useState<Property[]>([])
  const [loadingOrgs, setLoadingOrgs] = useState(true)
  const [loadingProperties, setLoadingProperties] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingOrgs(true)
      try {
        const res = await fetch('/api/v1/organizations')
        const body = await res.json()
        if (cancelled) return
        setOrgs((body.data ?? body.organizations ?? body.orgs ?? []) as OrgOption[])
      } catch {
        if (!cancelled) setError('Could not load clients.')
      } finally {
        if (!cancelled) setLoadingOrgs(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!value) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/properties/${encodeURIComponent(value)}`)
        const body = await res.json()
        const property = body.data as Property | undefined
        if (!cancelled && property?.orgId) setOrgId(property.orgId)
      } catch {
        if (!cancelled) setError('Could not resolve selected property.')
      }
    })()
    return () => { cancelled = true }
  }, [value])

  useEffect(() => {
    if (!orgId) {
      setProperties([])
      return
    }
    let cancelled = false
    ;(async () => {
      setLoadingProperties(true)
      try {
        const res = await fetch(`/api/v1/properties?${new URLSearchParams({ orgId })}`)
        const body = await res.json()
        if (!cancelled) setProperties((body.data ?? []) as Property[])
      } catch {
        if (!cancelled) {
          setProperties([])
          setError('Could not load client properties.')
        }
      } finally {
        if (!cancelled) setLoadingProperties(false)
      }
    })()
    return () => { cancelled = true }
  }, [orgId])

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === value),
    [properties, value],
  )

  return (
    <div className={`grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end ${className}`}>
      <div>
        <label className="text-xs text-on-surface-variant font-label block mb-1">Client</label>
        <select
          value={orgId}
          disabled={disabled || loadingOrgs}
          onChange={(event) => {
            setOrgId(event.target.value)
            onChange('')
          }}
          className="pib-input text-sm w-full"
        >
          <option value="">{loadingOrgs ? 'Loading clients...' : 'Select a client...'}</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-on-surface-variant font-label block mb-1">Property</label>
        <select
          value={value}
          disabled={disabled || !orgId || loadingProperties}
          onChange={(event) => onChange(event.target.value)}
          className="pib-input text-sm w-full"
        >
          <option value="">
            {!orgId
              ? 'Select a client first'
              : loadingProperties
                ? 'Loading properties...'
                : 'Select a property...'}
          </option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name} - {property.domain}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        {selectedProperty ? (
          <Link
            href={`/admin/properties/${selectedProperty.id}`}
            className="pib-btn-secondary text-xs font-label whitespace-nowrap"
          >
            Property setup
          </Link>
        ) : (
          <Link
            href="/admin/properties"
            className="pib-btn-secondary text-xs font-label whitespace-nowrap"
          >
            Properties
          </Link>
        )}
      </div>
      {error && <p className="md:col-span-3 text-xs text-red-400">{error}</p>}
    </div>
  )
}

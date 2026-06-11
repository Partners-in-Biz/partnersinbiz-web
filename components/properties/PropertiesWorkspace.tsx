'use client'

import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import type { Property, PropertyStatus } from '@/lib/properties/types'

type PropertiesSurface = 'admin' | 'portal'

type OrganizationOption = {
  id: string
  name: string
}

type WorkspaceProperty = {
  id: string
  name: string
  domain: string
  type: string
  status?: string | null
}

type WorkspaceConnection = {
  id: string
  provider: string
  propertyId: string
  status: string
  lastSuccessAt?: { _seconds: number } | null
}

type PortalDashboardData = {
  properties?: WorkspaceProperty[]
  connections?: WorkspaceConnection[]
}

type PropertiesWorkspaceProps = {
  surface: PropertiesSurface
}

const PROPERTY_STATUS: Record<PropertyStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'pib-pill-info' },
  active: { label: 'Active', className: 'pib-pill-success' },
  paused: { label: 'Paused', className: 'pib-pill-warn' },
  archived: { label: 'Archived', className: '' },
}

const CONNECTION_STATUS: Record<string, string> = {
  connected: 'pib-pill-success',
  paused: 'pib-pill-warn',
  reauth_required: 'pib-pill-warn',
  error: 'pib-pill-danger',
  pending: 'pib-pill-info',
}

const PROVIDER_LABEL: Record<string, string> = {
  adsense: 'AdSense',
  admob: 'AdMob',
  revenuecat: 'RevenueCat',
  app_store_connect: 'App Store Connect',
  play_console: 'Play Console',
  google_ads: 'Google Ads',
  ga4: 'Google Analytics',
  firebase_analytics: 'Firebase Analytics',
}

const PROVIDER_ICON: Record<string, string> = {
  adsense: 'ads_click',
  admob: 'ads_click',
  revenuecat: 'subscriptions',
  app_store_connect: 'phone_iphone',
  play_console: 'android',
  google_ads: 'campaign',
  ga4: 'analytics',
  firebase_analytics: 'flame',
}

const TYPE_ICON: Record<string, string> = {
  web: 'language',
  ios: 'phone_iphone',
  android: 'android',
  app: 'apps',
  universal: 'apps',
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function readable(value: string) {
  return value.replace(/_/g, ' ')
}

function ConnectionStatusPill({ status }: { status: string }) {
  return (
    <span className={`pib-pill ${CONNECTION_STATUS[status] ?? ''}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {readable(status)}
    </span>
  )
}

function PropertyStatusPill({ status }: { status?: string | null }) {
  const statusKey = (status || 'draft') as PropertyStatus
  const statusInfo = PROPERTY_STATUS[statusKey] ?? PROPERTY_STATUS.draft

  return (
    <span className={`pib-pill ${statusInfo.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {statusInfo.label}
    </span>
  )
}

function normaliseProperty(property: Property | WorkspaceProperty): WorkspaceProperty {
  return {
    id: property.id,
    name: property.name,
    domain: property.domain,
    type: property.type,
    status: 'status' in property ? property.status : undefined,
  }
}

function PropertyCard({
  property,
  connections,
  surface,
}: {
  property: WorkspaceProperty
  connections: WorkspaceConnection[]
  surface: PropertiesSurface
}) {
  const icon = TYPE_ICON[property.type] ?? 'inventory_2'
  const card = (
    <div className="pib-card-section">
      <div className="pib-card-section-header flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">{icon}</span>
          </div>
          <div>
            <h3 className="font-display text-xl leading-tight">{property.name}</h3>
            <p className="eyebrow !text-[10px] mt-1">{property.type} - {property.domain}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {surface === 'admin' ? <PropertyStatusPill status={property.status} /> : null}
          <span className="text-xs text-[var(--color-pib-text-muted)] font-mono whitespace-nowrap">
            {connections.length} connection{connections.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      {connections.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[var(--color-pib-line)]">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[var(--color-pib-surface)] hover:bg-[var(--color-pib-surface-2)] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">
                  {PROVIDER_ICON[connection.provider] ?? 'cable'}
                </span>
                <span className="text-sm truncate">{PROVIDER_LABEL[connection.provider] ?? connection.provider}</span>
              </div>
              <ConnectionStatusPill status={connection.status} />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-4 text-sm text-[var(--color-pib-text-muted)] italic">
          No data sources connected yet.
        </div>
      )}
    </div>
  )

  if (surface !== 'admin') return card

  return (
    <Link
      href={`/portal/properties/${property.id}`}
      className="block rounded-lg transition-colors hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-pib-bg)]"
      aria-label={`Open property ${property.name}`}
    >
      {card}
    </Link>
  )
}

export function PropertiesWorkspace({ surface }: PropertiesWorkspaceProps) {
  const isAdmin = surface === 'admin'
  const [properties, setProperties] = useState<WorkspaceProperty[]>([])
  const [connections, setConnections] = useState<WorkspaceConnection[]>([])
  const [loading, setLoading] = useState(!isAdmin)
  const [orgs, setOrgs] = useState<OrganizationOption[]>([])
  const [orgFilter, setOrgFilter] = useState('')
  const [orgLoadError, setOrgLoadError] = useState(false)

  useEffect(() => {
    if (!isAdmin) return

    fetch('/api/v1/organizations')
      .then((response) => response.json())
      .then((body) => {
        const options = Array.isArray(body.data)
          ? body.data
              .map((org: { id?: unknown; name?: unknown }) => ({
                id: typeof org.id === 'string' ? org.id : '',
                name: typeof org.name === 'string' ? org.name : '',
              }))
              .filter((org: OrganizationOption) => org.id && org.name)
          : []
        setOrgs(options)
      })
      .catch(() => setOrgLoadError(true))
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    if (!orgFilter) return

    let cancelled = false
    fetch(`/api/v1/properties?${new URLSearchParams({ orgId: orgFilter })}`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        const nextProperties = Array.isArray(body.data)
          ? body.data.map((property: Property) => normaliseProperty(property))
          : []
        setProperties(nextProperties)
        setConnections([])
      })
      .catch(() => {
        if (cancelled) return
        setProperties([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [isAdmin, orgFilter])

  useEffect(() => {
    if (isAdmin) return

    let cancelled = false
    fetch('/api/v1/portal/dashboard')
      .then((response) => response.json())
      .then((body: PortalDashboardData) => {
        if (cancelled) return
        setProperties(Array.isArray(body.properties) ? body.properties.map(normaliseProperty) : [])
        setConnections(Array.isArray(body.connections) ? body.connections : [])
      })
      .catch(() => {
        if (cancelled) return
        setProperties([])
        setConnections([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [isAdmin])

  const connectionsByProperty = useMemo(() => {
    const byProperty = new Map<string, WorkspaceConnection[]>()
    for (const connection of connections) {
      const current = byProperty.get(connection.propertyId) ?? []
      current.push(connection)
      byProperty.set(connection.propertyId, current)
    }
    return byProperty
  }, [connections])

  const emptyCopy = isAdmin
    ? orgFilter
      ? 'No properties yet.'
      : 'Select a client above to view their properties.'
    : 'Properties are created during onboarding. Reach out via Messages if you need one added.'

  function handleOrgFilterChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextOrgId = event.target.value
    setOrgFilter(nextOrgId)
    if (!nextOrgId) {
      setProperties([])
      setConnections([])
      setLoading(false)
      return
    }
    setLoading(true)
  }

  return (
    <div className={isAdmin ? 'space-y-6 max-w-5xl mx-auto' : 'space-y-10'}>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{isAdmin ? 'Admin workspace' : 'Your stack'}</p>
          <h1 className={isAdmin ? 'text-2xl font-headline font-bold text-on-surface mt-2' : 'pib-page-title mt-2'}>
            Properties
          </h1>
          <p className={isAdmin ? 'text-sm text-on-surface-variant mt-0.5' : 'pib-page-sub max-w-2xl'}>
            {isAdmin
              ? 'Marketing sites and apps connected to PiB.'
              : 'Each property - site, iOS app, Android app - and the data sources we have connected for you.'}
          </p>
        </div>
        {isAdmin ? (
          <Link href="/portal/properties/new" className="pib-btn-primary text-sm font-label self-start md:self-auto">
            + New Property
          </Link>
        ) : null}
      </header>

      {isAdmin ? (
        <div className="pib-card p-4">
          <label className="text-xs text-on-surface-variant font-label block mb-1" htmlFor="property-org-filter">
            Filter by Client
          </label>
          <select
            id="property-org-filter"
            value={orgFilter}
            onChange={handleOrgFilterChange}
            className="pib-input text-sm w-64 max-w-full"
          >
            <option value="">Select a client...</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          {orgLoadError ? <p className="text-xs text-red-400 mt-1">Could not load clients. Refresh to retry.</p> : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className={isAdmin ? 'h-24 rounded-xl' : 'h-32'} />
          ))}
        </div>
      ) : properties.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">apartment</span>
          <h2 className="font-display text-2xl mt-4">{isAdmin && orgFilter ? 'No properties yet.' : 'No properties yet'}</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-md mx-auto mt-2">{emptyCopy}</p>
          {isAdmin && orgFilter ? (
            <Link href="/portal/properties/new" className="btn-pib-secondary inline-flex mt-5">
              Create property
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {properties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              connections={connectionsByProperty.get(property.id) ?? []}
              surface={surface}
            />
          ))}
        </div>
      )}
    </div>
  )
}

'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { CompanyHeader } from '@/components/crm/CompanyHeader'
import { CompanyTabsBar, COMPANY_TABS } from '@/components/crm/CompanyTabsBar'
import type { CompanyTab } from '@/components/crm/CompanyTabsBar'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import { CompanyWorkspacePanel, type LinkedWorkspace } from '@/components/crm/CompanyWorkspacePanel'
import { EntityScopedChat } from '@/components/crm/EntityScopedChat'
import { CompanyEditDrawer, type CompanyTeamMember } from '@/components/crm/CompanyEditDrawer'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'
import { ContactForm } from '@/components/admin/crm/ContactForm'
import { DealDrawer } from '@/components/crm/DealDrawer'
import { scopeFromSearchParams, scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'

type RelatedContact = {
  id: string
  name?: string
  email?: string
  phone?: string
  type?: string
  stage?: string
  updatedAt?: unknown
}

type RelatedDeal = {
  id: string
  title?: string
  contactId?: string
  value?: number
  currency?: string
  stageId?: string
  probability?: number
  updatedAt?: unknown
}

type RelatedProject = {
  id: string
  name?: string
  status?: string
  description?: string
  updatedAt?: unknown
}

type RelatedDocument = {
  id: string
  title?: string
  status?: string
  type?: string
  updatedAt?: unknown
}

type RelatedServiceWorkspace = {
  id: string
  name?: string
  serviceType?: string
  status?: string
  visibility?: string
  updatedAt?: unknown
}

type RelatedRelationship = {
  id: string
  targetName?: string
  relationshipType?: string
  status?: string
  sharedCapabilities?: string[]
  updatedAt?: unknown
}

type RelatedQuote = {
  id: string
  quoteNumber?: string
  status?: string
  total?: number
  currency?: string
  validUntil?: unknown
  updatedAt?: unknown
}

type RelatedInvoice = {
  id: string
  invoiceNumber?: string
  status?: string
  total?: number
  currency?: string
  dueDate?: unknown
  publicToken?: string
  updatedAt?: unknown
}

type RelatedOrder = {
  id: string
  title?: string
  status?: string
  fulfillmentStatus?: string
  total?: number
  currency?: string
  updatedAt?: unknown
}

type RelatedShipment = {
  id: string
  status?: string
  carrier?: string
  trackingNumber?: string
  expectedDeliveryDate?: unknown
  updatedAt?: unknown
}

type RelatedInventoryItem = {
  id: string
  name?: string
  sku?: string
  status?: string
  quantityAvailable?: number
  lowStockThreshold?: number
  updatedAt?: unknown
}

type RelatedActivity = {
  id: string
  type?: string
  summary?: string
  createdAt?: unknown
}

const COMPANY_TAB_KEYS = new Set<CompanyTab>(COMPANY_TABS.map((tab) => tab.key))

function toCompanyTab(value: string | null): CompanyTab | null {
  if (!value) return null
  return COMPANY_TAB_KEYS.has(value as CompanyTab) ? value as CompanyTab : null
}

type CommandCenterSummary = {
  projects?: number
  serviceWorkspaces?: number
  relationships?: number
  orders?: number
  shipments?: number
  inventoryItems?: number
  openOrders?: number
  lowStockItems?: number
  overdueInvoices?: number
}

type CommandCenterAnalytics = {
  accountValue?: number
  weightedPipelineValue?: number
  trackedOrderValue?: number
  openProjectCount?: number
  activeServiceCount?: number
  collaborationCount?: number
  riskSignals?: string[]
}

type RelatedState = {
  linkedWorkspace: LinkedWorkspace | null
  contacts: RelatedContact[]
  deals: RelatedDeal[]
  projects: RelatedProject[]
  documents: RelatedDocument[]
  serviceWorkspaces: RelatedServiceWorkspace[]
  relationships: RelatedRelationship[]
  quotes: RelatedQuote[]
  invoices: RelatedInvoice[]
  orders: RelatedOrder[]
  shipments: RelatedShipment[]
  inventoryItems: RelatedInventoryItem[]
  activities: RelatedActivity[]
  summary: CommandCenterSummary
  analytics: CommandCenterAnalytics
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-24" />
      <div className="flex items-start gap-4">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function EmptyPanel({ icon, label, children }: { icon: string; label: string; children?: React.ReactNode }) {
  return (
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">
        {label}
      </p>
      {children ? <div className="mt-5 flex justify-center">{children}</div> : null}
    </div>
  )
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bento-card overflow-hidden">
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}

function StatusChip({ value, emptyLabel = 'Status not set' }: { value?: string; emptyLabel?: string }) {
  if (!value) return <span className="text-xs text-[var(--color-pib-text-muted)]">{emptyLabel}</span>
  return (
    <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-emerald-300">
      {readableStatusLabel(value)}
    </span>
  )
}

function readableStatusLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function formatCurrency(value?: number, currency = 'ZAR') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function dealValueLabel(deal: RelatedDeal) {
  return typeof deal.value === 'number' && Number.isFinite(deal.value)
    ? formatCurrency(deal.value, deal.currency || 'ZAR')
    : 'No value captured'
}

function dealProbabilityLabel(deal: RelatedDeal) {
  return typeof deal.probability === 'number' && Number.isFinite(deal.probability)
    ? `${deal.probability}%`
    : 'Probability not set'
}

function contactIdentityLabel(contact: RelatedContact) {
  return contact.name || contact.email || 'Contact name missing'
}

function projectNameLabel(project: RelatedProject) {
  return project.name || 'Project name missing'
}

function projectDescriptionLabel(project: RelatedProject) {
  return project.description || 'Description not captured'
}

function projectStatusLabel(project: RelatedProject) {
  return project.status ? undefined : 'Project status not set'
}

function projectUpdatedLabel(project: RelatedProject) {
  return dateReadinessLabel(project.updatedAt, 'Project update time not captured', 'Project update date needs review')
}

function serviceWorkspaceNameLabel(workspace: RelatedServiceWorkspace) {
  return workspace.name || 'Service workspace name missing'
}

function serviceWorkspaceTypeLabel(workspace: RelatedServiceWorkspace) {
  return workspace.serviceType || 'Service type not set'
}

function serviceWorkspaceVisibilityLabel(workspace: RelatedServiceWorkspace) {
  return workspace.visibility || 'Workspace visibility not set'
}

function serviceWorkspaceStatusLabel(workspace: RelatedServiceWorkspace) {
  return workspace.status ? undefined : 'Service status not set'
}

function documentTitleLabel(document: RelatedDocument) {
  return document.title || 'Document title missing'
}

function documentTypeLabel(document: RelatedDocument) {
  return document.type || 'Document type not set'
}

function documentStatusLabel(document: RelatedDocument) {
  return document.status ? undefined : 'Document status not set'
}

function documentUpdatedLabel(document: RelatedDocument) {
  return dateReadinessLabel(document.updatedAt, 'Document update time not captured', 'Document update date needs review')
}

function relationshipTargetLabel(relationship: RelatedRelationship) {
  return relationship.targetName || 'Relationship target missing'
}

function relationshipTypeLabel(relationship: RelatedRelationship) {
  return relationship.relationshipType || 'Relationship type not set'
}

function relationshipStatusLabel(relationship: RelatedRelationship) {
  return relationship.status ? undefined : 'Relationship status not set'
}

function relationshipCapabilitiesLabel(relationship: RelatedRelationship) {
  return Array.isArray(relationship.sharedCapabilities) && relationship.sharedCapabilities.length > 0
    ? relationship.sharedCapabilities.join(', ')
    : 'Shared capabilities not captured'
}

function quoteTotalLabel(quote: RelatedQuote) {
  return typeof quote.total === 'number' && Number.isFinite(quote.total)
    ? formatCurrency(quote.total, quote.currency || 'ZAR')
    : 'No total captured'
}

function invoiceTotalLabel(invoice: RelatedInvoice) {
  return typeof invoice.total === 'number' && Number.isFinite(invoice.total)
    ? formatCurrency(invoice.total, invoice.currency || 'ZAR')
    : 'No total captured'
}

function dateFromValue(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  else if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  } else if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown }
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate()
      return Number.isFinite(date.getTime()) ? date : null
    }
    else {
      const seconds = timestamp.seconds ?? timestamp._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000)
    }
  }
  return null
}

function hasUnreadableDate(value: unknown) {
  if (!value) return false
  if (value instanceof Date) return !Number.isFinite(value.getTime())
  if (typeof value === 'string') return !Number.isFinite(new Date(value).getTime())
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown }
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate()
      return !Number.isFinite(date.getTime())
    }
    if ('seconds' in timestamp || '_seconds' in timestamp) {
      const seconds = timestamp.seconds ?? timestamp._seconds
      return typeof seconds !== 'number' || !Number.isFinite(seconds)
    }
  }
  return false
}

function formatDate(value: unknown) {
  const date = dateFromValue(value)
  return date ? date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
}

function dateReadinessLabel(value: unknown, missingLabel: string, invalidLabel: string) {
  if (hasUnreadableDate(value)) return invalidLabel
  const date = formatDate(value)
  return date === '-' ? missingLabel : date
}

function quoteValidUntilLabel(quote: RelatedQuote) {
  return dateReadinessLabel(quote.validUntil, 'Valid date not set', 'Valid date needs review')
}

function invoiceDueDateLabel(invoice: RelatedInvoice) {
  return dateReadinessLabel(invoice.dueDate, 'Due date not set', 'Due date needs review')
}

function orderTitleLabel(order: RelatedOrder) {
  return order.title || 'Fulfillment order name missing'
}

function orderStatusLabel(order: RelatedOrder) {
  return order.status ? undefined : 'Order status not set'
}

function orderFulfillmentStatusLabel(order: RelatedOrder) {
  return order.fulfillmentStatus || 'Fulfillment status not set'
}

function orderTotalLabel(order: RelatedOrder) {
  return typeof order.total === 'number' && Number.isFinite(order.total)
    ? formatCurrency(order.total, order.currency || 'ZAR')
    : 'No total captured'
}

function shipmentCarrierLabel(shipment: RelatedShipment) {
  return shipment.carrier || 'Carrier not set'
}

function shipmentTrackingLabel(shipment: RelatedShipment) {
  return shipment.trackingNumber || 'Tracking number not set'
}

function shipmentExpectedDeliveryLabel(shipment: RelatedShipment) {
  return dateReadinessLabel(shipment.expectedDeliveryDate, 'Expected delivery not set', 'Expected delivery date needs review')
}

function shipmentStatusLabel(shipment: RelatedShipment) {
  return shipment.status ? undefined : 'Shipment status not set'
}

function inventoryItemNameLabel(item: RelatedInventoryItem) {
  return item.name || item.sku || 'Inventory item name missing'
}

function inventorySkuLabel(item: RelatedInventoryItem) {
  return item.sku || 'SKU not set'
}

function inventoryQuantityLabel(item: RelatedInventoryItem) {
  return typeof item.quantityAvailable === 'number' && Number.isFinite(item.quantityAvailable)
    ? `${item.quantityAvailable} available`
    : 'Quantity not captured'
}

function inventoryStatusLabel(item: RelatedInventoryItem) {
  return item.status ? undefined : 'Inventory status not set'
}

function activitySummaryLabel(activity: RelatedActivity) {
  return activity.summary || 'Activity summary missing'
}

function activityTypeLabel(activity: RelatedActivity) {
  return activity.type ? activity.type.replace(/_/g, ' ') : 'Activity type not set'
}

function activityCreatedAtLabel(activity: RelatedActivity) {
  return dateReadinessLabel(activity.createdAt, 'Activity time not captured', 'Activity time needs review')
}

function extractList<T>(body: unknown, key: keyof RelatedState): T[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  const value = data[key] ?? record[key]
  return Array.isArray(value) ? value as T[] : []
}

function ContactsPanel({
  contacts,
  company,
  onCreateContact,
}: {
  contacts: RelatedContact[]
  company: Company
  onCreateContact: () => void
}) {
  if (contacts.length === 0) {
    return (
      <EmptyPanel
        icon="person_add"
        label="No linked contacts yet. Add the first stakeholder so emails, deals, quotes, and activity have a real relationship anchor."
      >
        <button type="button" onClick={onCreateContact} className="btn-pib-primary inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
          Add first contact for {company.name}
        </button>
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Stakeholders</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Add every buyer, approver, finance owner, and delivery contact that matters for {company.name}.
          </p>
        </div>
        <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
          Add contact for {company.name}
        </button>
      </div>
      <TableShell>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
            <tr>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">Type</th>
              <th className="px-5 py-3 text-left">Stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-pib-line)]">
            {contacts.map((contact) => (
              <tr key={contact.id} className="hover:bg-white/[0.02]">
                <td className="px-5 py-4">
                  <Link href={`/portal/contacts/${contact.id}`} className="font-medium text-[var(--color-accent-v2)] hover:underline">
                    {contactIdentityLabel(contact)}
                  </Link>
                </td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{contact.email || 'No email captured'}</td>
                <td className="px-5 py-4"><StatusChip value={contact.type} emptyLabel="Type not set" /></td>
                <td className="px-5 py-4"><StatusChip value={contact.stage} emptyLabel="Stage not set" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  )
}

function contactLabel(contact: RelatedContact) {
  return contactIdentityLabel(contact)
}

function DealsPanel({
  deals,
  company,
  contacts,
  onCreateDeal,
  onCreateContact,
}: {
  deals: RelatedDeal[]
  company: Company
  contacts: RelatedContact[]
  onCreateDeal: () => void
  onCreateContact: () => void
}) {
  if (deals.length === 0) {
    const firstContact = contacts[0]
    return (
      <EmptyPanel
        icon="work_off"
        label={
          firstContact
            ? `No linked deals yet. Start the first opportunity against ${contactLabel(firstContact)} so pipeline, forecast, quotes, and activity stay anchored to this account.`
            : 'No linked deals yet. Add a stakeholder first so the first opportunity has a contact anchor.'
        }
      >
        {firstContact ? (
          <button type="button" onClick={onCreateDeal} className="btn-pib-primary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_business</span>
            Create first deal for {company.name}
          </button>
        ) : (
          <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
            Add contact before deal
          </button>
        )}
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Opportunities</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep every expansion, renewal, and new commercial track visible for {company.name}.
          </p>
        </div>
        {contacts[0] ? (
          <button type="button" onClick={onCreateDeal} className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_business</span>
            Add deal for {company.name}
          </button>
        ) : (
          <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
            Add contact before deal
          </button>
        )}
      </div>
      <TableShell>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
            <tr>
              <th className="px-5 py-3 text-left">Deal</th>
              <th className="px-5 py-3 text-left">Value</th>
              <th className="px-5 py-3 text-left">Stage</th>
              <th className="px-5 py-3 text-left">Probability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-pib-line)]">
            {deals.map((deal) => (
              <tr key={deal.id} className="hover:bg-white/[0.02]">
                <td className="px-5 py-4">
                  <Link href={`/portal/deals/${deal.id}`} className="font-medium text-[var(--color-accent-v2)] hover:underline">
                    {deal.title || deal.id}
                  </Link>
                </td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{dealValueLabel(deal)}</td>
                <td className="px-5 py-4"><StatusChip value={deal.stageId} emptyLabel="Stage not set" /></td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{dealProbabilityLabel(deal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  )
}

function dealLabel(deal: RelatedDeal) {
  return deal.title || deal.id
}

function numericDealValue(deal: RelatedDeal) {
  return typeof deal.value === 'number' && Number.isFinite(deal.value) ? deal.value : 0
}

function quoteLabel(quote: RelatedQuote) {
  return quote.quoteNumber || quote.id
}

function invoiceLabel(invoice: RelatedInvoice) {
  return invoice.invoiceNumber || invoice.id
}

function orderLabel(order: RelatedOrder) {
  return order.title || order.id
}

function inventorySkuForCompany(company: Company) {
  const base = company.name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `${base || 'ACCOUNT'}-TRACKED`
}

function ProjectsPanel({
  projects,
  company,
  contacts,
  workspace,
  creatingProject,
  projectError,
  onCreateProject,
  onCreateContact,
}: {
  projects: RelatedProject[]
  company: Company
  contacts: RelatedContact[]
  workspace?: LinkedWorkspace | null
  creatingProject: boolean
  projectError: string | null
  onCreateProject: () => void
  onCreateContact: () => void
}) {
  const firstContact = contacts[0]
  const scopedWorkspaceHref = (path: string) => (
    workspace ? scopedPortalPath(path, workspace) : path
  )
  if (projects.length === 0) {
    return (
      <EmptyPanel
        icon="folder_off"
        label={
          firstContact?.email
            ? `No linked projects yet. Start a discovery workspace with ${contactLabel(firstContact)} so delivery, documents, tasks, and account history stay connected.`
            : firstContact
              ? `No linked projects yet. ${contactLabel(firstContact)} needs an email before a shared project can be created for this account.`
              : 'No linked projects yet. Add a stakeholder first so the first project has a client anchor.'
        }
      >
        <div className="flex flex-col items-center gap-3">
          {firstContact?.email ? (
            <button
              type="button"
              onClick={onCreateProject}
              disabled={creatingProject}
              className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_task</span>
              {creatingProject ? 'Creating project...' : `Create discovery project for ${company.name}`}
            </button>
          ) : firstContact ? (
            <Link href={`/portal/contacts/${firstContact.id}`} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">alternate_email</span>
              Add email to {contactLabel(firstContact)}
            </Link>
          ) : (
            <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
              Add contact before project
            </button>
          )}
          {projectError ? <p className="max-w-md text-xs text-red-300">{projectError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Delivery workspaces</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep every discovery sprint, build, handoff, and delivery track connected to {company.name}.
          </p>
        </div>
        {firstContact?.email ? (
          <button
            type="button"
            onClick={onCreateProject}
            disabled={creatingProject}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_task</span>
            {creatingProject ? 'Creating project...' : `Create another project for ${company.name}`}
          </button>
        ) : firstContact ? (
          <Link href={`/portal/contacts/${firstContact.id}`} className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">alternate_email</span>
            Add email to {contactLabel(firstContact)}
          </Link>
        ) : (
          <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
            Add contact before project
          </button>
        )}
      </div>
      {projectError ? <p className="text-xs text-red-300">{projectError}</p> : null}
      <SimpleRowsPanel
        rows={projects}
        emptyIcon="folder_off"
        emptyLabel="No linked projects yet."
        title={(row) => projectNameLabel(row as RelatedProject)}
        hrefFor={(row) => scopedWorkspaceHref(`/portal/projects/${row.id}`)}
        metaFor={(row) => [
          projectDescriptionLabel(row as RelatedProject),
          projectStatusLabel(row as RelatedProject),
          projectUpdatedLabel(row as RelatedProject),
        ]}
      />
    </div>
  )
}

function ServicesPanel({
  serviceWorkspaces,
  company,
  contacts,
  projects,
  creatingService,
  serviceError,
  onCreateService,
}: {
  serviceWorkspaces: RelatedServiceWorkspace[]
  company: Company
  contacts: RelatedContact[]
  projects: RelatedProject[]
  creatingService: boolean
  serviceError: string | null
  onCreateService: () => void
}) {
  const firstProject = projects[0]
  const firstContact = contacts[0]
  if (serviceWorkspaces.length === 0) {
    return (
      <EmptyPanel
        icon="workspaces"
        label={
          firstProject
            ? `No service workspaces yet. Create the first workspace around ${firstProject.name || firstProject.id} so delivery, documents, reports, and account activity stay together.`
            : firstContact
              ? `No service workspaces yet. Start the first operational workspace for ${contactLabel(firstContact)} so delivery does not live outside the CRM.`
              : 'No service workspaces yet. Start the first operational workspace for this account.'
        }
      >
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onCreateService}
            disabled={creatingService}
            className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">workspaces</span>
            {creatingService ? 'Creating workspace...' : `Create service workspace for ${company.name}`}
          </button>
          {serviceError ? <p className="max-w-md text-xs text-red-300">{serviceError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Service workspaces</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep every retainer, delivery lane, and operational workspace connected to {company.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateService}
          disabled={creatingService}
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">workspaces</span>
          {creatingService ? 'Creating workspace...' : `Create another service workspace for ${company.name}`}
        </button>
      </div>
      {serviceError ? <p className="text-xs text-red-300">{serviceError}</p> : null}
      <SimpleRowsPanel
        rows={serviceWorkspaces}
        emptyIcon="workspaces"
        emptyLabel="No service workspaces yet."
        title={(row) => serviceWorkspaceNameLabel(row as RelatedServiceWorkspace)}
        metaFor={(row) => [
          serviceWorkspaceTypeLabel(row as RelatedServiceWorkspace),
          serviceWorkspaceVisibilityLabel(row as RelatedServiceWorkspace),
          serviceWorkspaceStatusLabel(row as RelatedServiceWorkspace),
        ]}
      />
    </div>
  )
}

function DocumentsPanel({
  documents,
  company,
  workspace,
  creatingDocument,
  documentError,
  onCreateDocument,
}: {
  documents: RelatedDocument[]
  company: Company
  workspace?: LinkedWorkspace | null
  creatingDocument: boolean
  documentError: string | null
  onCreateDocument: () => void
}) {
  const scopedWorkspaceHref = (path: string) => (
    workspace ? scopedPortalPath(path, workspace) : path
  )

  if (documents.length === 0) {
    return (
      <EmptyPanel
        icon="description"
        label={`No linked documents yet. Start a sales proposal draft for ${company.name} so commercial context, approvals, and client-facing history stay attached to this account.`}
      >
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onCreateDocument}
            disabled={creatingDocument}
            className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">note_add</span>
            {creatingDocument ? 'Creating proposal...' : `Create sales proposal for ${company.name}`}
          </button>
          {documentError ? <p className="max-w-md text-xs text-red-300">{documentError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Commercial documents</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep proposals, approvals, and client-facing account history connected to {company.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateDocument}
          disabled={creatingDocument}
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">note_add</span>
          {creatingDocument ? 'Creating proposal...' : `Create another sales proposal for ${company.name}`}
        </button>
      </div>
      {documentError ? <p className="text-xs text-red-300">{documentError}</p> : null}
      <SimpleRowsPanel
        rows={documents}
        emptyIcon="description"
        emptyLabel="No linked documents yet."
        title={(row) => documentTitleLabel(row as RelatedDocument)}
        hrefFor={(row) => scopedWorkspaceHref(`/portal/documents/${row.id}`)}
        metaFor={(row) => [
          documentTypeLabel(row as RelatedDocument),
          documentStatusLabel(row as RelatedDocument),
          documentUpdatedLabel(row as RelatedDocument),
        ]}
      />
    </div>
  )
}

function RelationshipsPanel({
  relationships,
  company,
  contacts,
  creatingRelationship,
  relationshipError,
  onCreateRelationship,
}: {
  relationships: RelatedRelationship[]
  company: Company
  contacts: RelatedContact[]
  creatingRelationship: boolean
  relationshipError: string | null
  onCreateRelationship: () => void
}) {
  const firstContact = contacts[0]
  if (relationships.length === 0) {
    return (
      <EmptyPanel
        icon="hub"
        label={
          firstContact
            ? `No business relationships yet. Create the account relationship for ${contactLabel(firstContact)} so shared CRM, projects, documents, and services become visible from one place.`
            : `No business relationships yet. Create the account relationship for ${company.name} so collaboration history does not stay hidden from the CRM.`
        }
      >
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onCreateRelationship}
            disabled={creatingRelationship}
            className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_link</span>
            {creatingRelationship ? 'Creating relationship...' : `Create relationship for ${company.name}`}
          </button>
          {relationshipError ? <p className="max-w-md text-xs text-red-300">{relationshipError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Business relationships</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep partnerships, shared delivery, and collaboration context connected to {company.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateRelationship}
          disabled={creatingRelationship}
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_link</span>
          {creatingRelationship ? 'Creating relationship...' : `Create another relationship for ${company.name}`}
        </button>
      </div>
      {relationshipError ? <p className="text-xs text-red-300">{relationshipError}</p> : null}
      <SimpleRowsPanel
        rows={relationships}
        emptyIcon="hub"
        emptyLabel="No business relationships yet."
        title={(row) => relationshipTargetLabel(row as RelatedRelationship)}
        metaFor={(row) => [
          relationshipTypeLabel(row as RelatedRelationship),
          relationshipStatusLabel(row as RelatedRelationship),
          relationshipCapabilitiesLabel(row as RelatedRelationship),
        ]}
      />
    </div>
  )
}

function QuotesPanel({
  quotes,
  company,
  deals,
  creatingQuote,
  quoteError,
  onCreateQuote,
  onCreateDeal,
}: {
  quotes: RelatedQuote[]
  company: Company
  deals: RelatedDeal[]
  creatingQuote: boolean
  quoteError: string | null
  onCreateQuote: () => void
  onCreateDeal: () => void
}) {
  if (quotes.length === 0) {
    const firstDeal = deals[0]
    return (
      <EmptyPanel
        icon="request_quote"
        label={
          firstDeal
            ? `No linked quotes yet. Turn ${dealLabel(firstDeal)} into the first commercial proposal for ${company.name}.`
            : 'No linked quotes yet. Create a deal first so pricing, forecast, and quote history stay connected.'
        }
      >
        <div className="flex flex-col items-center gap-3">
          {firstDeal ? (
            <button
              type="button"
              onClick={onCreateQuote}
              disabled={creatingQuote}
              className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">request_quote</span>
              {creatingQuote ? 'Creating quote...' : `Create quote from ${dealLabel(firstDeal)}`}
            </button>
          ) : (
            <button type="button" onClick={onCreateDeal} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_business</span>
              Create deal before quote
            </button>
          )}
          {quoteError ? <p className="max-w-md text-xs text-red-300">{quoteError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  const firstDeal = deals[0]
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Commercial quotes</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep proposal momentum, pricing context, and validity windows connected to {company.name}.
          </p>
        </div>
        {firstDeal ? (
          <button
            type="button"
            onClick={onCreateQuote}
            disabled={creatingQuote}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">request_quote</span>
            {creatingQuote ? 'Creating quote...' : `Create another quote from ${dealLabel(firstDeal)}`}
          </button>
        ) : (
          <button type="button" onClick={onCreateDeal} className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_business</span>
            Create deal before quote
          </button>
        )}
      </div>
      {quoteError ? <p className="text-xs text-red-300">{quoteError}</p> : null}
      <TableShell>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
            <tr>
              <th className="px-5 py-3 text-left">Quote</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Total</th>
              <th className="px-5 py-3 text-left">Valid Until</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-pib-line)]">
            {quotes.map((quote) => (
              <tr key={quote.id} className="hover:bg-white/[0.02]">
                <td className="px-5 py-4 font-mono">{quote.quoteNumber || quote.id}</td>
                <td className="px-5 py-4"><StatusChip value={quote.status} emptyLabel="Quote status not set" /></td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{quoteTotalLabel(quote)}</td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{quoteValidUntilLabel(quote)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  )
}

function InvoicesPanel({
  invoices,
  company,
  quotes,
  creatingInvoiceId,
  invoiceError,
  onCreateInvoiceFromQuote,
}: {
  invoices: RelatedInvoice[]
  company: Company
  quotes: RelatedQuote[]
  creatingInvoiceId: string | null
  invoiceError: string | null
  onCreateInvoiceFromQuote: (quote: RelatedQuote) => void
}) {
  if (invoices.length === 0) {
    const acceptedQuote = quotes.find((quote) => quote.status === 'accepted')
    return (
      <EmptyPanel
        icon="receipt_long"
        label={
          acceptedQuote
            ? `No linked invoices yet. Convert ${quoteLabel(acceptedQuote)} into a draft invoice so accepted revenue for ${company.name} moves into billing.`
            : quotes.length > 0
              ? `No linked invoices yet. Accept a quote for ${company.name} before converting it into billing.`
              : `No linked invoices yet. Create and accept a quote for ${company.name} before billing this account.`
        }
      >
        <div className="flex flex-col items-center gap-3">
          {acceptedQuote ? (
            <button
              type="button"
              onClick={() => onCreateInvoiceFromQuote(acceptedQuote)}
              disabled={creatingInvoiceId === acceptedQuote.id}
              className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">receipt_long</span>
              {creatingInvoiceId === acceptedQuote.id ? 'Creating invoice...' : `Create invoice from ${quoteLabel(acceptedQuote)}`}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="btn-pib-secondary inline-flex cursor-not-allowed items-center gap-1.5 opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">approval</span>
              Accept quote before invoice
            </button>
          )}
          {invoiceError ? <p className="max-w-md text-xs text-red-300">{invoiceError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  const acceptedQuote = quotes.find((quote) => quote.status === 'accepted')
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Billing invoices</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep accepted revenue, billing status, due dates, and finance handoffs connected to {company.name}.
          </p>
        </div>
        {acceptedQuote ? (
          <button
            type="button"
            onClick={() => onCreateInvoiceFromQuote(acceptedQuote)}
            disabled={creatingInvoiceId === acceptedQuote.id}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">receipt_long</span>
            {creatingInvoiceId === acceptedQuote.id ? 'Creating invoice...' : `Create another invoice from ${quoteLabel(acceptedQuote)}`}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="btn-pib-secondary inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">approval</span>
            Accept quote before invoice
          </button>
        )}
      </div>
      {invoiceError ? <p className="text-xs text-red-300">{invoiceError}</p> : null}
      <TableShell>
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-pib-line)] text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
            <tr>
              <th className="px-5 py-3 text-left">Invoice</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Total</th>
              <th className="px-5 py-3 text-left">Due</th>
              <th className="px-5 py-3 text-right">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-pib-line)]">
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="hover:bg-white/[0.02]">
                <td className="px-5 py-4 font-mono">{invoice.invoiceNumber || invoice.id}</td>
                <td className="px-5 py-4"><StatusChip value={invoice.status} emptyLabel="Invoice status not set" /></td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{invoiceTotalLabel(invoice)}</td>
                <td className="px-5 py-4 text-[var(--color-pib-text-muted)]">{invoiceDueDateLabel(invoice)}</td>
                <td className="px-5 py-4 text-right">
                  <a href={`/api/v1/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent-v2)] hover:underline">
                    Open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  )
}

function OrdersPanel({
  orders,
  company,
  invoices,
  creatingOrder,
  orderError,
  onCreateOrderFromInvoice,
}: {
  orders: RelatedOrder[]
  company: Company
  invoices: RelatedInvoice[]
  creatingOrder: boolean
  orderError: string | null
  onCreateOrderFromInvoice: (invoice: RelatedInvoice) => void
}) {
  if (orders.length === 0) {
    const firstInvoice = invoices[0]
    return (
      <EmptyPanel
        icon="orders"
        label={
          firstInvoice
            ? `No linked orders yet. Turn ${invoiceLabel(firstInvoice)} into the first fulfillment order so delivery, shipments, and inventory work stay tied to ${company.name}.`
            : `No linked orders yet. Create an invoice for ${company.name} before opening fulfillment work.`
        }
      >
        <div className="flex flex-col items-center gap-3">
          {firstInvoice ? (
            <button
              type="button"
              onClick={() => onCreateOrderFromInvoice(firstInvoice)}
              disabled={creatingOrder}
              className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_shopping_cart</span>
              {creatingOrder ? 'Creating order...' : `Create fulfillment order from ${invoiceLabel(firstInvoice)}`}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="btn-pib-secondary inline-flex cursor-not-allowed items-center gap-1.5 opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">receipt_long</span>
              Create invoice before order
            </button>
          )}
          {orderError ? <p className="max-w-md text-xs text-red-300">{orderError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  const firstInvoice = invoices[0]
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Fulfillment orders</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep delivery commitments, order value, and fulfillment status connected to {company.name}.
          </p>
        </div>
        {firstInvoice ? (
          <button
            type="button"
            onClick={() => onCreateOrderFromInvoice(firstInvoice)}
            disabled={creatingOrder}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_shopping_cart</span>
            {creatingOrder ? 'Creating order...' : `Create another fulfillment order from ${invoiceLabel(firstInvoice)}`}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="btn-pib-secondary inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">receipt_long</span>
            Create invoice before order
          </button>
        )}
      </div>
      {orderError ? <p className="text-xs text-red-300">{orderError}</p> : null}
      <SimpleRowsPanel
        rows={orders}
        emptyIcon="orders"
        emptyLabel="No linked orders yet."
        title={(row) => orderTitleLabel(row as RelatedOrder)}
        metaFor={(row) => [
          orderFulfillmentStatusLabel(row as RelatedOrder),
          orderTotalLabel(row as RelatedOrder),
          orderStatusLabel(row as RelatedOrder),
        ]}
      />
    </div>
  )
}

function ShipmentsPanel({
  shipments,
  company,
  orders,
  creatingShipment,
  shipmentError,
  onCreateShipmentFromOrder,
}: {
  shipments: RelatedShipment[]
  company: Company
  orders: RelatedOrder[]
  creatingShipment: boolean
  shipmentError: string | null
  onCreateShipmentFromOrder: (order: RelatedOrder) => void
}) {
  if (shipments.length === 0) {
    const firstOrder = orders[0]
    return (
      <EmptyPanel
        icon="local_shipping"
        label={
          firstOrder
            ? `No shipments yet. Open the first delivery record for ${orderLabel(firstOrder)} so carrier, tracking, and expected delivery stay tied to ${company.name}.`
            : `No shipments yet. Create a fulfillment order for ${company.name} before tracking delivery.`
        }
      >
        <div className="flex flex-col items-center gap-3">
          {firstOrder ? (
            <button
              type="button"
              onClick={() => onCreateShipmentFromOrder(firstOrder)}
              disabled={creatingShipment}
              className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">local_shipping</span>
              {creatingShipment ? 'Creating shipment...' : `Create shipment for ${orderLabel(firstOrder)}`}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="btn-pib-secondary inline-flex cursor-not-allowed items-center gap-1.5 opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">orders</span>
              Create order before shipment
            </button>
          )}
          {shipmentError ? <p className="max-w-md text-xs text-red-300">{shipmentError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  const firstOrder = orders[0]
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Delivery shipments</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep carrier, tracking, and expected delivery context connected to {company.name}.
          </p>
        </div>
        {firstOrder ? (
          <button
            type="button"
            onClick={() => onCreateShipmentFromOrder(firstOrder)}
            disabled={creatingShipment}
            className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">local_shipping</span>
            {creatingShipment ? 'Creating shipment...' : `Create another shipment for ${orderLabel(firstOrder)}`}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="btn-pib-secondary inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">orders</span>
            Create order before shipment
          </button>
        )}
      </div>
      {shipmentError ? <p className="text-xs text-red-300">{shipmentError}</p> : null}
      <SimpleRowsPanel
        rows={shipments}
        emptyIcon="local_shipping"
        emptyLabel="No shipments yet."
        title={(row) => shipmentCarrierLabel(row as RelatedShipment)}
        metaFor={(row) => [
          shipmentTrackingLabel(row as RelatedShipment),
          shipmentExpectedDeliveryLabel(row as RelatedShipment),
          shipmentStatusLabel(row as RelatedShipment),
        ]}
      />
    </div>
  )
}

function InventoryPanel({
  inventoryItems,
  company,
  creatingInventoryItem,
  inventoryError,
  onCreateInventoryItem,
}: {
  inventoryItems: RelatedInventoryItem[]
  company: Company
  creatingInventoryItem: boolean
  inventoryError: string | null
  onCreateInventoryItem: () => void
}) {
  if (inventoryItems.length === 0) {
    return (
      <EmptyPanel
        icon="inventory_2"
        label={`No inventory items yet. Start a tracked item for ${company.name} so stock, reservations, low-stock warnings, and fulfillment history have an operational anchor.`}
      >
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onCreateInventoryItem}
            disabled={creatingInventoryItem}
            className="btn-pib-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_box</span>
            {creatingInventoryItem ? 'Creating item...' : `Create inventory item for ${company.name}`}
          </button>
          {inventoryError ? <p className="max-w-md text-xs text-red-300">{inventoryError}</p> : null}
        </div>
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Inventory control</p>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Keep stock levels, reservations, low-stock thresholds, and fulfillment readiness visible for {company.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateInventoryItem}
          disabled={creatingInventoryItem}
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add_box</span>
          {creatingInventoryItem ? 'Creating item...' : `Create another inventory item for ${company.name}`}
        </button>
      </div>
      {inventoryError ? <p className="text-xs text-red-300">{inventoryError}</p> : null}
      <SimpleRowsPanel
        rows={inventoryItems}
        emptyIcon="inventory_2"
        emptyLabel="No inventory items yet."
        title={(row) => inventoryItemNameLabel(row as RelatedInventoryItem)}
        metaFor={(row) => [
          inventorySkuLabel(row as RelatedInventoryItem),
          inventoryQuantityLabel(row as RelatedInventoryItem),
          inventoryStatusLabel(row as RelatedInventoryItem),
        ]}
      />
    </div>
  )
}

function SimpleRowsPanel({
  rows,
  emptyIcon,
  emptyLabel,
  title,
  hrefFor,
  metaFor,
}: {
  rows: Array<{ id: string; [key: string]: unknown }>
  emptyIcon: string
  emptyLabel: string
  title: (row: { id: string; [key: string]: unknown }) => string
  hrefFor?: (row: { id: string; [key: string]: unknown }) => string | undefined
  metaFor: (row: { id: string; [key: string]: unknown }) => Array<string | undefined>
}) {
  if (rows.length === 0) return <EmptyPanel icon={emptyIcon} label={emptyLabel} />
  return (
    <div className="bento-card divide-y divide-[var(--color-pib-line)]">
      {rows.map((row) => {
        const rowTitle = title(row)
        const href = hrefFor?.(row)
        const meta = metaFor(row).filter(Boolean)
        return (
          <div key={row.id} className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {href ? (
                <Link href={href} className="font-medium text-sm text-[var(--color-accent-v2)] hover:underline">
                  {rowTitle}
                </Link>
              ) : (
                <p className="font-medium text-sm text-[var(--color-pib-text)]">{rowTitle}</p>
              )}
              {meta.length > 0 && (
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  {meta.join(' · ')}
                </p>
              )}
            </div>
            {'status' in row && typeof row.status === 'string' ? <StatusChip value={row.status} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function AnalyticsPanel({
  analytics,
  summary,
  companyName,
  onOpenTab,
}: {
  analytics: CommandCenterAnalytics
  summary: CommandCenterSummary
  companyName: string
  onOpenTab: (tab: CompanyTab) => void
}) {
  const tiles = [
    { label: 'Account value', value: formatCurrency(analytics.accountValue ?? 0), icon: 'payments' },
    { label: 'Weighted pipeline', value: formatCurrency(analytics.weightedPipelineValue ?? 0), icon: 'query_stats' },
    { label: 'Tracked orders', value: formatCurrency(analytics.trackedOrderValue ?? 0), icon: 'orders' },
    { label: 'Open projects', value: String(analytics.openProjectCount ?? summary.projects ?? 0), icon: 'folder_managed' },
    { label: 'Active services', value: String(analytics.activeServiceCount ?? summary.serviceWorkspaces ?? 0), icon: 'workspaces' },
    { label: 'Collaborations', value: String(analytics.collaborationCount ?? summary.relationships ?? 0), icon: 'hub' },
  ]
  const riskSignals = analytics.riskSignals ?? []
  const lowStockItems = summary.lowStockItems ?? 0
  const openOrders = summary.openOrders ?? 0
  const overdueInvoices = summary.overdueInvoices ?? 0
  const weightedPipelineValue = analytics.weightedPipelineValue ?? 0
  const operatingActions: Array<{
    label: string
    value: string
    icon: string
    tab: CompanyTab
    ariaLabel: string
    tone: 'risk' | 'watch' | 'good'
  }> = [
    ...(lowStockItems > 0
      ? [{
          label: 'Inventory risk',
          value: `${lowStockItems} low-stock ${lowStockItems === 1 ? 'item' : 'items'}`,
          icon: 'inventory_2',
          tab: 'inventory' as CompanyTab,
          ariaLabel: `Review inventory risk for ${companyName}`,
          tone: 'risk' as const,
        }]
      : [{
          label: 'Inventory coverage',
          value: 'No low-stock items',
          icon: 'inventory_2',
          tab: 'inventory' as CompanyTab,
          ariaLabel: `Review inventory coverage for ${companyName}`,
          tone: 'good' as const,
        }]),
    {
      label: 'Fulfillment',
      value: openOrders > 0 ? `${openOrders} open ${openOrders === 1 ? 'order' : 'orders'}` : 'No open order blockers',
      icon: 'orders',
      tab: 'orders',
      ariaLabel: `Review fulfillment orders for ${companyName}`,
      tone: openOrders > 0 ? 'watch' : 'good',
    },
    {
      label: 'Cash collection',
      value: overdueInvoices > 0 ? `${overdueInvoices} overdue ${overdueInvoices === 1 ? 'invoice' : 'invoices'}` : 'No overdue invoices',
      icon: 'receipt_long',
      tab: 'invoices',
      ariaLabel: `Review cash collection for ${companyName}`,
      tone: overdueInvoices > 0 ? 'risk' : 'good',
    },
    {
      label: 'Pipeline',
      value: weightedPipelineValue > 0 ? `${formatCurrency(weightedPipelineValue)} weighted` : 'No weighted pipeline',
      icon: 'query_stats',
      tab: 'deals',
      ariaLabel: `Review pipeline for ${companyName}`,
      tone: weightedPipelineValue > 0 ? 'watch' : 'risk',
    },
  ]
  const toneClass = {
    risk: 'border-red-400/30 bg-red-500/10 text-red-200',
    watch: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
    good: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="pib-stat-card">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">{tile.label}</p>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{tile.icon}</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">{tile.value}</p>
          </div>
        ))}
      </div>
      <div className="bento-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow !text-[10px]">Account operating brief</p>
            <h3 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Where the team should act next</h3>
          </div>
          <span className="rounded-full border border-[var(--color-pib-line)] px-2.5 py-1 text-xs text-[var(--color-pib-text-muted)]">
            {riskSignals.length > 0 ? `${riskSignals.length} active signal${riskSignals.length === 1 ? '' : 's'}` : 'No active risks'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {operatingActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onOpenTab(action.tab)}
              aria-label={action.ariaLabel}
              className={`rounded-xl border p-4 text-left transition-transform hover:-translate-y-0.5 ${toneClass[action.tone]}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-label uppercase tracking-widest opacity-80">{action.label}</span>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{action.icon}</span>
              </div>
              <p className="mt-3 text-sm font-semibold">{action.value}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="bento-card p-5">
        <p className="eyebrow !text-[10px]">Risk signals</p>
        {riskSignals.length === 0 ? (
          <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="eyebrow !text-[10px] text-emerald-200">Risk watch clear</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Keep leadership risk reviewable</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              No active risk signals are flagged for {companyName}. Review invoices, orders, and inventory so finance, delivery, and relationship risk stay visible before the account surprises leadership.
            </p>
            <button
              type="button"
              onClick={() => onOpenTab('invoices')}
              aria-label={`Review invoices, orders, and inventory for ${companyName}`}
              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">fact_check</span>
              Review risk records
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {riskSignals.map((signal) => (
              <span key={signal} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200">
                {signal}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityPanel({
  activities,
  company,
  contacts,
  noteOpen,
  note,
  savingNote,
  noteError,
  onOpenNote,
  onNoteChange,
  onSaveNote,
  onCancelNote,
  onCreateContact,
}: {
  activities: RelatedActivity[]
  company: Company
  contacts: RelatedContact[]
  noteOpen: boolean
  note: string
  savingNote: boolean
  noteError: string | null
  onOpenNote: () => void
  onNoteChange: (value: string) => void
  onSaveNote: () => void
  onCancelNote: () => void
  onCreateContact: () => void
}) {
  const firstContact = contacts[0]
  const contactName = firstContact ? contactLabel(firstContact) : null
  const companyNoteLabel = contactName
    ? `Company note for ${company.name} anchored to ${contactName}`
    : `Company note for ${company.name}`
  const dismissCompanyNoteLabel = `Dismiss company note composer for ${company.name}`
  const cancelCompanyNoteLabel = `Cancel company note for ${company.name}`
  const saveCompanyNoteLabel = `Save company note for ${company.name}`
  const composer = noteOpen && firstContact ? (
    <div className="bento-card p-5 text-left">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-[10px]">Company note</p>
          <h3 className="mt-1 font-display text-lg text-[var(--color-pib-text)]">Log context for {company.name}</h3>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Anchored to {contactLabel(firstContact)} so this note joins the contact and company timeline.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancelNote}
          className="text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
          aria-label={dismissCompanyNoteLabel}
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      <div className="mt-4 space-y-3">
        <label htmlFor="company-activity-note" className="block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
          Company note
        </label>
        <textarea
          id="company-activity-note"
          aria-label={companyNoteLabel}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={4}
          className="pib-input w-full resize-none"
          placeholder="Capture a decision, call summary, risk, or follow-up..."
        />
        {noteError ? <p className="text-xs text-red-300">{noteError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancelNote}
            disabled={savingNote}
            className="btn-pib-secondary"
            aria-label={cancelCompanyNoteLabel}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveNote}
            disabled={savingNote || !note.trim()}
            className="btn-pib-primary disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={saveCompanyNoteLabel}
          >
            {savingNote ? 'Saving...' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  if (activities.length === 0) {
    if (composer) return composer
    return (
      <EmptyPanel
        icon="history"
        label={
          firstContact
            ? `No company activity yet. Log the first note against ${contactLabel(firstContact)} so the account timeline starts with real sales context.`
            : 'No company activity yet. Add a stakeholder first so notes, calls, and emails have a contact anchor.'
        }
      >
        {firstContact ? (
          <button type="button" onClick={onOpenNote} className="btn-pib-primary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_note</span>
            Log first note for {company.name}
          </button>
        ) : (
          <button type="button" onClick={onCreateContact} className="btn-pib-secondary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">person_add</span>
            Add contact before activity
          </button>
        )}
      </EmptyPanel>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={onOpenNote} className="btn-pib-secondary inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_note</span>
          Log note
        </button>
      </div>
      {composer}
      <div className="bento-card divide-y divide-[var(--color-pib-line)]">
        {activities.map((activity) => (
          <div key={activity.id} className="px-5 py-4 flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm text-[var(--color-pib-text)]">{activitySummaryLabel(activity)}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">{activityTypeLabel(activity)}</p>
            </div>
            <span className="text-xs text-[var(--color-pib-text-muted)] shrink-0">{activityCreatedAtLabel(activity)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = scopeFromSearchParams(searchParams)
  const scopedOrgId = orgScope.orgId
  const initialTab = toCompanyTab(searchParams.get('tab')) ?? 'overview'
  const companyApiPath = useCallback((path: string) => scopedApiPath(path, { orgId: scopedOrgId }), [scopedOrgId])

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [tab, setTab] = useState<CompanyTab>(initialTab)
  const [editOpen, setEditOpen] = useState(false)
  const [newContactOpen, setNewContactOpen] = useState(false)
  const [newDealOpen, setNewDealOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [companyNote, setCompanyNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [creatingService, setCreatingService] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [creatingDocument, setCreatingDocument] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [creatingRelationship, setCreatingRelationship] = useState(false)
  const [relationshipError, setRelationshipError] = useState<string | null>(null)
  const [creatingInvoiceId, setCreatingInvoiceId] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [creatingShipment, setCreatingShipment] = useState(false)
  const [shipmentError, setShipmentError] = useState<string | null>(null)
  const [creatingInventoryItem, setCreatingInventoryItem] = useState(false)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [creatingQuote, setCreatingQuote] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [teamMembers, setTeamMembers] = useState<CompanyTeamMember[]>([])
  const [related, setRelated] = useState<RelatedState>({
    linkedWorkspace: null,
    contacts: [],
    deals: [],
    projects: [],
    documents: [],
    serviceWorkspaces: [],
    relationships: [],
    quotes: [],
    invoices: [],
    orders: [],
    shipments: [],
    inventoryItems: [],
    activities: [],
    summary: {},
    analytics: {},
  })

  useEffect(() => {
    if (searchParams.get('edit') === 'profile') {
      setEditOpen(true)
    }
  }, [searchParams])

  useEffect(() => {
    setTab(toCompanyTab(searchParams.get('tab')) ?? 'overview')
  }, [searchParams])

  const selectTab = useCallback((nextTab: CompanyTab) => {
    setTab(nextTab)

    const params = new URLSearchParams(searchParams.toString())
    if (nextTab === 'overview') {
      params.delete('tab')
    } else {
      params.set('tab', nextTab)
    }

    const query = params.toString()
    router.replace(`/portal/companies/${id}${query ? `?${query}` : ''}`, { scroll: false })
  }, [id, router, searchParams])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedError, setRelatedError] = useState<string | null>(null)

  useEffect(() => {
    fetch(companyApiPath('/api/v1/crm/custom-fields?resource=company'))
      .then((r) => r.json())
      .then((b) => setCustomFieldDefs(b.data?.definitions ?? b.definitions ?? []))
      .catch(() => setCustomFieldDefs([]))
  }, [companyApiPath])

  useEffect(() => {
    let cancelled = false
    fetch(companyApiPath('/api/v1/portal/settings/team'))
      .then((res) => res.ok ? res.json() : null)
      .then((body) => {
        if (cancelled) return
        const members = Array.isArray(body?.members) ? body.members : []
        setTeamMembers(members.filter((member: CompanyTeamMember) => member.uid))
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([])
      })
    return () => { cancelled = true }
  }, [companyApiPath])

  const fetchCompany = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(companyApiPath(`/api/v1/crm/companies/${id}`))
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setCompany(body.data?.company ?? body.data ?? body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load company')
    } finally {
      setLoading(false)
    }
  }, [id, companyApiPath])

  useEffect(() => {
    void fetchCompany()
  }, [fetchCompany])

  const loadRelated = useCallback(async (nextCompanyId: string, isCancelled: () => boolean = () => false) => {
      setRelatedLoading(true)
      setRelatedError(null)
      try {
        const commandCenterRes = await fetch(companyApiPath(`/api/v1/crm/companies/${nextCompanyId}/command-center?limit=100`))
        if (!commandCenterRes.ok) {
          const body = await commandCenterRes.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${commandCenterRes.status}`)
        }
        const commandCenterBody = await commandCenterRes.json()
        if (!isCancelled()) {
          const commandData = commandCenterBody?.data ?? commandCenterBody ?? {}
          setRelated({
            linkedWorkspace: (commandData.linkedWorkspace ?? null) as LinkedWorkspace | null,
            contacts: extractList<RelatedContact>(commandCenterBody, 'contacts'),
            deals: extractList<RelatedDeal>(commandCenterBody, 'deals'),
            projects: extractList<RelatedProject>(commandCenterBody, 'projects'),
            documents: extractList<RelatedDocument>(commandCenterBody, 'documents'),
            serviceWorkspaces: extractList<RelatedServiceWorkspace>(commandCenterBody, 'serviceWorkspaces'),
            relationships: extractList<RelatedRelationship>(commandCenterBody, 'relationships'),
            quotes: extractList<RelatedQuote>(commandCenterBody, 'quotes'),
            invoices: extractList<RelatedInvoice>(commandCenterBody, 'invoices'),
            orders: extractList<RelatedOrder>(commandCenterBody, 'orders'),
            shipments: extractList<RelatedShipment>(commandCenterBody, 'shipments'),
            inventoryItems: extractList<RelatedInventoryItem>(commandCenterBody, 'inventoryItems'),
            activities: extractList<RelatedActivity>(commandCenterBody, 'activities'),
            summary: (commandData.summary ?? {}) as CommandCenterSummary,
            analytics: (commandData.analytics ?? {}) as CommandCenterAnalytics,
          })
        }
      } catch (err) {
        if (!isCancelled()) setRelatedError(err instanceof Error ? err.message : 'Failed to load linked records')
      } finally {
        if (!isCancelled()) setRelatedLoading(false)
      }
  }, [companyApiPath])

  const companyId = company?.id
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void loadRelated(companyId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [companyId, loadRelated])

  async function handleSave(patch: Partial<Company>): Promise<void> {
    const res = await fetch(companyApiPath(`/api/v1/crm/companies/${id}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Save failed')
    }
    await fetchCompany()
  }

  async function createCompanyContact(data: Record<string, unknown>): Promise<void> {
    if (!company) return
    const res = await fetch(companyApiPath('/api/v1/crm/contacts'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...data,
        company: company.name,
        companyId: company.id,
        companyName: company.name,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to create contact')
    }
    setNewContactOpen(false)
    await loadRelated(company.id)
  }

  async function handleDealSaved(): Promise<void> {
    if (!company) return
    setNewDealOpen(false)
    await loadRelated(company.id)
  }

  async function saveCompanyNote(): Promise<void> {
    if (!company) return
    const firstContact = related.contacts[0]
    if (!firstContact) {
      setNoteError('Add a contact before logging activity.')
      return
    }
    const summary = companyNote.trim()
    if (!summary) return

    setSavingNote(true)
    setNoteError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/crm/activities'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactId: firstContact.id,
          companyId: company.id,
          type: 'note',
          summary,
          metadata: {
            source: 'company_detail',
            companyName: company.name,
            contactName: contactLabel(firstContact),
          },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to log activity')
      }
      setCompanyNote('')
      setNoteOpen(false)
      await loadRelated(company.id)
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Failed to log activity')
    } finally {
      setSavingNote(false)
    }
  }

  async function createDiscoveryProject(): Promise<void> {
    if (!company) return
    const firstContact = related.contacts[0]
    if (!firstContact) {
      setProjectError('Add a contact before creating a project.')
      return
    }
    if (!firstContact.email) {
      setProjectError('Add an email to the contact before creating a shared project.')
      return
    }
    setCreatingProject(true)
    setProjectError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/projects'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${company.name} discovery project`,
          status: 'discovery',
          companyId: company.id,
          contactId: firstContact.id,
          recipientEmail: firstContact.email,
          recipientName: contactLabel(firstContact),
          recipientCompanyName: company.name,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create project')
      await loadRelated(company.id)
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setCreatingProject(false)
    }
  }

  async function createServiceWorkspace(): Promise<void> {
    if (!company) return
    const firstContact = related.contacts[0]
    const firstProject = related.projects[0]
    setCreatingService(true)
    setServiceError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/service-workspaces'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          contactId: firstContact?.id,
          projectId: firstProject?.id,
          linkedProjectIds: firstProject ? [firstProject.id] : undefined,
          name: `${company.name} service workspace`,
          serviceType: 'custom',
          status: 'active',
          visibility: 'relationship',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create service workspace')
      await loadRelated(company.id)
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : 'Failed to create service workspace')
    } finally {
      setCreatingService(false)
    }
  }

  async function createSalesProposalDocument(): Promise<void> {
    if (!company) return
    setCreatingDocument(true)
    setDocumentError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/client-documents'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `${company.name} sales proposal`,
          type: 'sales_proposal',
          linked: {
            companyId: company.id,
            clientOrgId: company.linkedOrgId,
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create document')
      await loadRelated(company.id)
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : 'Failed to create document')
    } finally {
      setCreatingDocument(false)
    }
  }

  async function createBusinessRelationship(): Promise<void> {
    if (!company) return
    const firstContact = related.contacts[0]
    setCreatingRelationship(true)
    setRelationshipError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/crm/relationships'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceCompanyId: company.id,
          sourceContactId: firstContact?.id,
          targetOrgId: company.linkedOrgId,
          targetName: company.name,
          relationshipType: 'customer',
          status: 'active',
          sharedCapabilities: ['crm', 'projects', 'documents', 'services'],
          visibility: 'relationship',
          approvalState: 'approved',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create relationship')
      await loadRelated(company.id)
    } catch (err) {
      setRelationshipError(err instanceof Error ? err.message : 'Failed to create relationship')
    } finally {
      setCreatingRelationship(false)
    }
  }

  async function createQuoteFromFirstDeal(): Promise<void> {
    if (!company) return
    const firstDeal = related.deals[0]
    if (!firstDeal) {
      setQuoteError('Create a deal before creating a quote.')
      return
    }
    setCreatingQuote(true)
    setQuoteError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/quotes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dealId: firstDeal.id,
          contactId: firstDeal.contactId || related.contacts[0]?.id,
          companyId: company.id,
          currency: firstDeal.currency || 'ZAR',
          lineItems: numericDealValue(firstDeal) > 0 ? [
            {
              description: dealLabel(firstDeal),
              quantity: 1,
              unitPrice: numericDealValue(firstDeal),
            },
          ] : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create quote')
      await loadRelated(company.id)
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'Failed to create quote')
    } finally {
      setCreatingQuote(false)
    }
  }

  async function createInvoiceFromQuote(quote: RelatedQuote): Promise<void> {
    if (!company) return
    setCreatingInvoiceId(quote.id)
    setInvoiceError(null)
    try {
      const res = await fetch(companyApiPath(`/api/v1/quotes/${quote.id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'convert-to-invoice' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create invoice')
      await loadRelated(company.id)
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setCreatingInvoiceId(null)
    }
  }

  async function createOrderFromInvoice(invoice: RelatedInvoice): Promise<void> {
    if (!company) return
    const firstContact = related.contacts[0]
    setCreatingOrder(true)
    setOrderError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/orders'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          contactId: firstContact?.id,
          invoiceId: invoice.id,
          title: `${company.name} fulfillment order`,
          status: 'confirmed',
          fulfillmentStatus: 'not_started',
          lineItems: [],
          subtotal: typeof invoice.total === 'number' ? invoice.total : 0,
          taxAmount: 0,
          total: typeof invoice.total === 'number' ? invoice.total : 0,
          currency: invoice.currency || 'ZAR',
          visibility: 'relationship',
          approvalState: 'approved',
          notes: `Created from ${invoiceLabel(invoice)} on the company command center.`,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create order')
      await loadRelated(company.id)
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to create order')
    } finally {
      setCreatingOrder(false)
    }
  }

  async function createShipmentFromOrder(order: RelatedOrder): Promise<void> {
    if (!company) return
    setCreatingShipment(true)
    setShipmentError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/shipments'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          orderId: order.id,
          status: 'pending',
          carrier: 'Internal delivery',
          visibility: 'relationship',
          approvalState: 'approved',
          notes: `Created from ${orderLabel(order)} on the company command center.`,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create shipment')
      await loadRelated(company.id)
    } catch (err) {
      setShipmentError(err instanceof Error ? err.message : 'Failed to create shipment')
    } finally {
      setCreatingShipment(false)
    }
  }

  async function createTrackedInventoryItem(): Promise<void> {
    if (!company) return
    setCreatingInventoryItem(true)
    setInventoryError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/inventory-items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          name: `${company.name} tracked inventory`,
          sku: inventorySkuForCompany(company),
          quantityAvailable: 0,
          quantityReserved: 0,
          lowStockThreshold: 1,
          unit: 'item',
          location: 'Client account',
          visibility: 'relationship',
          approvalState: 'approved',
          notes: `Created on the ${company.name} company command center.`,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to create inventory item')
      await loadRelated(company.id)
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : 'Failed to create inventory item')
    } finally {
      setCreatingInventoryItem(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!company) return
    setDeleting(true)
    setArchiveError(null)
    try {
      const res = await fetch(companyApiPath(`/api/v1/crm/companies/${id}`), { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      router.push('/portal/companies')
      router.refresh()
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to archive company')
      setDeleting(false)
    }
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) return <PageSkeleton />

  if (error || !company) {
    return (
      <div className="bento-card p-10 text-center space-y-4">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">
          {error ? 'error_outline' : 'domain_disabled'}
        </span>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {error ?? 'Company not found.'}
        </p>
        <Link
          href="/portal/companies"
          aria-label="Back to Companies"
          className="btn-pib-secondary inline-flex items-center gap-1.5 mt-2"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-sm">arrow_back</span>
          Back to companies
        </Link>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/portal/companies"
        aria-label="Back to Companies"
        className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-sm">arrow_back</span>
        Companies
      </Link>

      {/* Header */}
      <div className="bento-card p-5">
        <CompanyHeader
          company={company}
          onEdit={() => setEditOpen(true)}
          onDelete={() => {
            setArchiveConfirmOpen(true)
            setArchiveError(null)
          }}
          deleting={deleting}
          stats={{
            contacts: related.contacts.length,
            deals: related.deals.length,
            projects: related.projects.length,
            documents: related.documents.length,
            activity: related.activities.length,
          }}
        />
      </div>

      {archiveError && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          <span className="material-symbols-outlined mr-1.5 align-middle text-[16px]" aria-hidden="true">error</span>
          {archiveError}
        </div>
      )}

      {archiveConfirmOpen && (
        <section
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="company-archive-confirm-title"
          aria-describedby="company-archive-confirm-description"
          className="rounded-lg border border-red-400/25 bg-red-500/10 p-5 shadow-[0_18px_40px_rgba(127,29,29,0.18)]"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] !text-red-100/80">Account archive</p>
                <h2 id="company-archive-confirm-title" className="mt-1 font-display text-lg text-red-50">
                  Archive account &quot;{company.name}&quot;?
                </h2>
                <p id="company-archive-confirm-description" className="mt-2 max-w-2xl text-sm text-red-100/90">
                  This removes the account from active company views while preserving linked contacts, deals, quotes, activities, and audit history.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button
                type="button"
                aria-label={`Cancel archive ${company.name}`}
                onClick={() => {
                  setArchiveConfirmOpen(false)
                  setArchiveError(null)
                }}
                className="btn-pib-secondary text-xs"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                aria-label={`Confirm archive ${company.name}`}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-50 transition-colors hover:border-red-200/60 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deleting}
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">archive</span>
                {deleting ? 'Archiving...' : 'Archive account'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Tabs */}
      <CompanyTabsBar
        activeTab={tab}
        onChange={(t) => {
          const nextTab = toCompanyTab(t)
          if (nextTab) selectTab(nextTab)
        }}
        counts={{
          contacts: related.contacts.length,
          deals: related.deals.length,
          projects: related.projects.length,
          documents: related.documents.length,
          services: related.serviceWorkspaces.length,
          relationships: related.relationships.length,
          quotes: related.quotes.length,
          invoices: related.invoices.length,
          orders: related.orders.length,
          shipments: related.shipments.length,
          inventory: related.inventoryItems.length,
          activity: related.activities.length,
        }}
        includeWorkspace={Boolean(related.linkedWorkspace)}
      />

      {/* Tab content */}
      <div role="tabpanel">
        {relatedError && tab !== 'overview' && (
          <div className="bento-card p-4 mb-4 text-sm text-red-300 border border-red-500/30">
            {relatedError}
          </div>
        )}
        {relatedLoading && tab !== 'overview' && <Skeleton className="h-36 w-full" />}
        {tab === 'overview' && (
          <div className="space-y-6">
            <CompanyOverviewPanel
              company={company}
              loading={relatedLoading}
              center={{
                contacts: related.contacts,
                deals: related.deals,
                projects: related.projects,
                documents: related.documents,
                serviceWorkspaces: related.serviceWorkspaces,
                relationships: related.relationships,
                quotes: related.quotes,
                invoices: related.invoices,
                orders: related.orders,
                shipments: related.shipments,
                inventoryItems: related.inventoryItems,
                activities: related.activities,
                summary: related.summary,
                analytics: related.analytics,
              }}
              onSelectTab={(nextTab) => {
                const selectedTab = toCompanyTab(nextTab)
                if (selectedTab) selectTab(selectedTab)
              }}
              onEditCompany={() => setEditOpen(true)}
            />
            {customFieldDefs.length > 0 && (
              <div className="bento-card p-5 space-y-3">
                <p className="eyebrow !text-[10px]">Custom fields</p>
                <CustomFieldsSection
                  definitions={customFieldDefs}
                  values={(company.customFields as Record<string, unknown>) ?? {}}
                  mode="read"
                  emptyAction={{
                    label: 'Capture fields',
                    ariaLabel: `Capture custom fields for ${company.name}`,
                    onClick: () => setEditOpen(true),
                  }}
                />
              </div>
            )}
          </div>
        )}
        {!relatedLoading && tab === 'workspace' && (
          <CompanyWorkspacePanel
            companyName={company.name}
            companyId={company.id}
            mode="portal"
            workspace={related.linkedWorkspace}
          />
        )}
        {!relatedLoading && tab === 'contacts' && (
          <ContactsPanel
            contacts={related.contacts}
            company={company}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'deals' && (
          <DealsPanel
            deals={related.deals}
            company={company}
            contacts={related.contacts}
            onCreateDeal={() => setNewDealOpen(true)}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'projects' && (
          <ProjectsPanel
            projects={related.projects}
            company={company}
            contacts={related.contacts}
            workspace={related.linkedWorkspace}
            creatingProject={creatingProject}
            projectError={projectError}
            onCreateProject={createDiscoveryProject}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'documents' && (
          <DocumentsPanel
            documents={related.documents}
            company={company}
            workspace={related.linkedWorkspace}
            creatingDocument={creatingDocument}
            documentError={documentError}
            onCreateDocument={createSalesProposalDocument}
          />
        )}
        {!relatedLoading && tab === 'services' && (
          <ServicesPanel
            serviceWorkspaces={related.serviceWorkspaces}
            company={company}
            contacts={related.contacts}
            projects={related.projects}
            creatingService={creatingService}
            serviceError={serviceError}
            onCreateService={createServiceWorkspace}
          />
        )}
        {!relatedLoading && tab === 'relationships' && (
          <RelationshipsPanel
            relationships={related.relationships}
            company={company}
            contacts={related.contacts}
            creatingRelationship={creatingRelationship}
            relationshipError={relationshipError}
            onCreateRelationship={createBusinessRelationship}
          />
        )}
        {!relatedLoading && tab === 'quotes' && (
          <QuotesPanel
            quotes={related.quotes}
            company={company}
            deals={related.deals}
            creatingQuote={creatingQuote}
            quoteError={quoteError}
            onCreateQuote={createQuoteFromFirstDeal}
            onCreateDeal={() => setNewDealOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'invoices' && (
          <InvoicesPanel
            invoices={related.invoices}
            company={company}
            quotes={related.quotes}
            creatingInvoiceId={creatingInvoiceId}
            invoiceError={invoiceError}
            onCreateInvoiceFromQuote={createInvoiceFromQuote}
          />
        )}
        {!relatedLoading && tab === 'orders' && (
          <OrdersPanel
            orders={related.orders}
            company={company}
            invoices={related.invoices}
            creatingOrder={creatingOrder}
            orderError={orderError}
            onCreateOrderFromInvoice={createOrderFromInvoice}
          />
        )}
        {!relatedLoading && tab === 'shipments' && (
          <ShipmentsPanel
            shipments={related.shipments}
            company={company}
            orders={related.orders}
            creatingShipment={creatingShipment}
            shipmentError={shipmentError}
            onCreateShipmentFromOrder={createShipmentFromOrder}
          />
        )}
        {!relatedLoading && tab === 'inventory' && (
          <InventoryPanel
            inventoryItems={related.inventoryItems}
            company={company}
            creatingInventoryItem={creatingInventoryItem}
            inventoryError={inventoryError}
            onCreateInventoryItem={createTrackedInventoryItem}
          />
        )}
        {!relatedLoading && tab === 'analytics' && (
          <AnalyticsPanel analytics={related.analytics} summary={related.summary} companyName={company.name} onOpenTab={selectTab} />
        )}
        {!relatedLoading && tab === 'activity' && (
          <ActivityPanel
            activities={related.activities}
            company={company}
            contacts={related.contacts}
            noteOpen={noteOpen}
            note={companyNote}
            savingNote={savingNote}
            noteError={noteError}
            onOpenNote={() => setNoteOpen(true)}
            onNoteChange={setCompanyNote}
            onSaveNote={saveCompanyNote}
            onCancelNote={() => {
              setNoteOpen(false)
              setCompanyNote('')
              setNoteError(null)
            }}
            onCreateContact={() => setNewContactOpen(true)}
          />
        )}
        {!relatedLoading && tab === 'chat' && (
          <EntityScopedChat
            orgId={company.orgId}
            orgName={company.name}
            entityType="company"
            entityId={company.id}
            entityLabel={company.name}
            href={`/portal/companies/${company.id}`}
            summary={`${company.name} CRM company${company.lifecycleStage ? ` · ${company.lifecycleStage}` : ''}${company.linkedOrgId ? ` · linked workspace ${company.linkedOrgId}` : ' · unlinked lead workspace'}`}
          />
        )}
      </div>

      {/* Edit drawer */}
      {editOpen && (
        <CompanyEditDrawer
          company={company}
          mode="edit"
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
          teamMembers={teamMembers}
          customFieldDefinitions={customFieldDefs}
        />
      )}

      {newContactOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label={`New contact for ${company.name}`}
        >
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setNewContactOpen(false)} />
          <div className="w-full max-w-md overflow-y-auto border-l border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-6 py-4">
              <div>
                <p className="eyebrow !text-[10px]">Company contact</p>
                <h2 className="font-display text-lg">New contact for {company.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setNewContactOpen(false)}
                className="text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
                aria-label={`Close contact drawer for ${company.name}`}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <ContactForm
              onSave={createCompanyContact}
              onCancel={() => setNewContactOpen(false)}
              contextName={company.name}
              initial={{
                company: company.name,
                companyId: company.id,
                companyName: company.name,
              }}
            />
          </div>
        </div>
      )}

      {newDealOpen && related.contacts[0] && (
        <DealDrawer
          defaultContactId={related.contacts[0].id}
          defaultContactLabel={contactLabel(related.contacts[0])}
          defaultCompanyId={company.id}
          defaultCompanyName={company.name}
          orgId={company.orgId}
          onSaved={handleDealSaved}
          onClose={() => setNewDealOpen(false)}
        />
      )}
    </div>
  )
}

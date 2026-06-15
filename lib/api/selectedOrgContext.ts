import type { ApiUser } from './types'
import { canAccessOrg } from './platformAdmin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export type SelectedOrgContextSource = 'requestedOrgId' | 'activeOrgId' | 'defaultOrgId' | 'orgIds'

export type SelectedOrgContextClassification =
  | 'selected-org-aware'
  | 'CRM-scoped'
  | 'intentionally global'
  | 'not applicable'

export interface SelectedOrgContextOk {
  ok: true
  orgId: string
  source: SelectedOrgContextSource
  selectedOrgId?: string
  defaultOrgId?: string
  accessibleOrgIds: string[]
}

export interface SelectedOrgContextErr {
  ok: false
  status: 400 | 403
  error: string
}

export type SelectedOrgContextResult = SelectedOrgContextOk | SelectedOrgContextErr

export interface SelectedOrgContextAuditEntry {
  surface: string
  classification: SelectedOrgContextClassification
  resolver: 'selectedOrgContext' | 'crmScopeOrgId' | 'global' | 'token'
  notes: string
}

function cleanOrgId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueOrgIds(values: unknown[]): string[] {
  const ids = new Set<string>()
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const nested of value) {
        const orgId = cleanOrgId(nested)
        if (orgId) ids.add(orgId)
      }
      continue
    }
    const orgId = cleanOrgId(value)
    if (orgId) ids.add(orgId)
  }
  return Array.from(ids)
}

function accessibleOrgIdsForUser(user: ApiUser): string[] {
  if (user.role === 'client') {
    return uniqueOrgIds([user.orgIds, user.orgId])
  }

  if (user.role === 'admin') {
    return uniqueOrgIds([user.allowedOrgIds, user.orgId, user.activeOrgId, PIB_PLATFORM_ORG_ID])
  }

  return uniqueOrgIds([user.orgIds, user.orgId, user.activeOrgId])
}

function canUseRequestedOrg(user: ApiUser, requestedOrgId: string, accessibleOrgIds: string[]): boolean {
  if (user.role === 'ai') return true
  if (user.role === 'admin') return requestedOrgId === PIB_PLATFORM_ORG_ID || canAccessOrg(user, requestedOrgId)
  return accessibleOrgIds.includes(requestedOrgId)
}

export function resolveSelectedOrgContext(
  user: ApiUser,
  requestedOrgId?: string | null,
): SelectedOrgContextResult {
  const requested = cleanOrgId(requestedOrgId)
  const selectedOrgId = cleanOrgId(user.activeOrgId)
  const defaultOrgId = cleanOrgId(user.orgId)
  const accessibleOrgIds = accessibleOrgIdsForUser(user)

  if (requested) {
    if (!canUseRequestedOrg(user, requested, accessibleOrgIds)) {
      return { ok: false, status: 403, error: 'You do not have access to this organisation' }
    }
    return {
      ok: true,
      orgId: requested,
      source: 'requestedOrgId',
      selectedOrgId: selectedOrgId || undefined,
      defaultOrgId: defaultOrgId || undefined,
      accessibleOrgIds,
    }
  }

  if (user.role === 'admin' || user.role === 'ai') {
    return { ok: false, status: 400, error: 'orgId is required (admin role must scope explicitly)' }
  }

  if (!accessibleOrgIds.length) {
    return {
      ok: false,
      status: 403,
      error: 'No organisation membership — ask your account owner to invite you.',
    }
  }

  if (selectedOrgId && accessibleOrgIds.includes(selectedOrgId)) {
    return {
      ok: true,
      orgId: selectedOrgId,
      source: 'activeOrgId',
      selectedOrgId,
      defaultOrgId: defaultOrgId || undefined,
      accessibleOrgIds,
    }
  }

  if (defaultOrgId && accessibleOrgIds.includes(defaultOrgId)) {
    return {
      ok: true,
      orgId: defaultOrgId,
      source: 'defaultOrgId',
      selectedOrgId: selectedOrgId || undefined,
      defaultOrgId,
      accessibleOrgIds,
    }
  }

  return {
    ok: true,
    orgId: accessibleOrgIds[0],
    source: 'orgIds',
    selectedOrgId: selectedOrgId || undefined,
    defaultOrgId: defaultOrgId || undefined,
    accessibleOrgIds,
  }
}

export const SELECTED_ORG_CONTEXT_AUDIT_MAP: SelectedOrgContextAuditEntry[] = [
  {
    surface: 'agent-chat-and-runs',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Hermes conversations, prompts, run payloads, and scheduled work should carry the active selected workspace org.',
  },
  {
    surface: 'projects-kanban',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Project/task/comment/evidence defaults should use selected workspace context unless a route/project id has an explicit tenant.',
  },
  {
    surface: 'client-documents',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Spec, report, brief, approval, review, and document list/create defaults should follow the selected workspace.',
  },
  {
    surface: 'workspace-files-artifacts',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Folders, uploads, Drive docs, generated assets, and artifacts should default to the selected workspace.',
  },
  {
    surface: 'briefings-inbox-notifications',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Attention feeds, briefing lists, inbox summaries, and notification dashboards should use selected workspace scope where tenant data is shown.',
  },
  {
    surface: 'reports-dashboards',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Activity summaries, analytics, monthly reports, support/social stats, and dashboards should prefer active selected org.',
  },
  {
    surface: 'support',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Ticket lists, ticket creates, summaries, and comments should default to selected workspace.',
  },
  {
    surface: 'social-content-seo-ads',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Campaign, content, SEO sprint, and ads workspace defaults should follow the selected workspace while preserving approval gates.',
  },
  {
    surface: 'research-intelligence',
    classification: 'selected-org-aware',
    resolver: 'selectedOrgContext',
    notes: 'Research items, citations, competitor notes, and generated recommendations should default to selected workspace.',
  },
  {
    surface: 'crm-company-contact-deal-views',
    classification: 'CRM-scoped',
    resolver: 'crmScopeOrgId',
    notes: 'CRM list/detail surfaces keep explicit CRM org, company, contact, deal, and command-center filters; do not silently switch to generic selected-org lists.',
  },
  {
    surface: 'crm-company-invoices',
    classification: 'CRM-scoped',
    resolver: 'crmScopeOrgId',
    notes: 'Company invoice tabs stay on company/command-center invoice payloads with company filtering, not generic invoice lists.',
  },
  {
    surface: 'platform-admin-settings',
    classification: 'intentionally global',
    resolver: 'global',
    notes: 'Super-admin platform settings, agent registry, policy, feature flags, and internal operations are platform/global unless a route explicitly selects a client org.',
  },
  {
    surface: 'public-tokenized-links',
    classification: 'not applicable',
    resolver: 'token',
    notes: 'Public invoice/document/PDF links resolve by signed/tokenized public route, not current user selected organisation.',
  },
]

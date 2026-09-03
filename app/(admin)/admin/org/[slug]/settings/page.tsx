'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { copyToClipboard } from '@/lib/utils/clipboard'
import { LEGACY_GOOGLE_WORKSPACE_CONNECTION_KEY, UNIFIED_GOOGLE_WORKSPACE_CONNECTION_KEY, UNIFIED_GOOGLE_WORKSPACE_SCOPES, workspaceScopeRows } from '@/lib/mailbox/googleOAuth'
import { X_MCP_CAPABILITY_SCOPES, X_MCP_CLIENT_CONFIG, X_MCP_CONNECTION_KEY, X_MCP_SCOPE_ROWS } from '@/lib/workspace-os/xMcp'
import type { WorkspaceFolder } from '@/lib/workspace-folders/model'
import { parseDriveFolderId } from '@/lib/workspace-folders/drive'

interface OrgForm {
  // General settings
  name: string
  website: string
  description: string
  industry: string
  billingEmail: string
  status: string
  notificationEmail: string
  defaultApprovalRequired: boolean
  timezone: string
  currency: 'USD' | 'EUR' | 'ZAR'
  portalModules: Record<string, boolean>
  portalMobileApps: boolean
  portalYouTubeStudio: boolean
  portalBookStudio: boolean
  // Email send-time optimisation
  preferredSendHourLocal: number
  preferredSendDaysOfWeek: number[]
  replyNotifyEmails: string
  // Billing address
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
  // Company billing details
  legalName: string
  tradingName: string
  vatNumber: string
  registrationNumber: string
  taxNumber: string
  phone: string
  accountsContactName: string
  accountsContactTitle: string
  accountsContactEmail: string
  accountsContactPhone: string
  authorizedSignatoryName: string
  authorizedSignatoryTitle: string
  authorizedSignatoryEmail: string
  authorizedSignatoryPhone: string
  purchaseOrderRequired: boolean
  purchaseOrderNumber: string
  invoiceInstructions: string
  // Banking
  bankName: string
  accountHolder: string
  accountNumber: string
  branchCode: string
  routingNumber: string
  swiftCode: string
  iban: string
}

const emptyForm: OrgForm = {
  name: '', website: '', description: '', industry: '', billingEmail: '',
  status: 'active', notificationEmail: '', defaultApprovalRequired: false, timezone: 'Africa/Johannesburg', currency: 'ZAR',
  portalModules: {}, portalMobileApps: true, portalYouTubeStudio: true, portalBookStudio: false,
  preferredSendHourLocal: 9, preferredSendDaysOfWeek: [1, 2, 3, 4, 5], replyNotifyEmails: '',
  line1: '', line2: '', city: '', state: '', postalCode: '', country: '',
  legalName: '', tradingName: '', vatNumber: '', registrationNumber: '', taxNumber: '', phone: '',
  accountsContactName: '', accountsContactTitle: '', accountsContactEmail: '', accountsContactPhone: '',
  authorizedSignatoryName: '', authorizedSignatoryTitle: '', authorizedSignatoryEmail: '', authorizedSignatoryPhone: '',
  purchaseOrderRequired: false, purchaseOrderNumber: '', invoiceInstructions: '',
  bankName: '', accountHolder: '', accountNumber: '', branchCode: '',
  routingNumber: '', swiftCode: '', iban: '',
}

type WorkspaceFolderWithId = WorkspaceFolder & { id: string }
type OrgSummary = { id: string; name?: string; slug?: string }
type CrmCompanySummary = { id: string; name?: string; domain?: string }
type FolderMappingForm = { name: string; driveFolderUrl: string; scope: 'workspace' | 'crm_company'; companyId: string; visibility: WorkspaceFolder['visibility'] }
type WorkspaceConnectionSummary = {
  id: string
  displayName?: string
  connectionKey?: string | null
  connectionType?: string
  status?: string
  tokenStatus?: string
  provider?: string
  ownerUserId?: string | null
  safeMetadata?: Record<string, unknown>
}

const GOOGLE_WORKSPACE_OAUTH_SCOPES = workspaceScopeRows(UNIFIED_GOOGLE_WORKSPACE_SCOPES)
const EMPTY_FOLDER_MAPPING_FORM: FolderMappingForm = { name: '', driveFolderUrl: '', scope: 'workspace', companyId: '', visibility: 'admin_agents' }

const REQUIRED_WORKSPACE_OAUTHS = [
  {
    key: UNIFIED_GOOGLE_WORKSPACE_CONNECTION_KEY,
    aliases: [LEGACY_GOOGLE_WORKSPACE_CONNECTION_KEY],
    displayName: 'Unified Google Workspace: Drive, Docs, Sheets, Gmail & Calendar',
    description: 'Required for Drive folder mappings, Docs/Sheets broker jobs, Gmail-safe mailbox handling, Calendar scheduling, artifact exports, and sync audits.',
    capabilityScopes: ['drive.read', 'drive.write', 'docs.write', 'sheets.write', 'gmail.read', 'gmail.send', 'calendar.events'],
    capabilities: { driveRead: true, driveWrite: true, driveShare: false, driveDelete: false, docsRead: true, docsWrite: true, sheetsRead: true, sheetsWrite: true, externalShare: false },
  },
] as const

function folderVisibilityLabel(value: WorkspaceFolder['visibility']) {
  if (value === 'admin_only') return 'Admin only'
  if (value === 'admin_agents_clients') return 'Admin + agents + clients'
  return 'Admin + agents'
}

function folderSourceOfTruthLabel(value: WorkspaceFolder['sourceOfTruth']) {
  if (value === 'google_drive') return 'Google Drive is source of truth'
  if (value === 'local') return 'Local Cowork is source of truth'
  if (value === 'vps') return 'VPS is source of truth'
  return 'Mixed source of truth'
}

function folderSyncModeLabel(value: WorkspaceFolder['syncMode']) {
  if (value === 'metadata_only') return 'Metadata only'
  if (value === 'manual') return 'Manual sync'
  return 'Full sync'
}

function folderSyncTargetLabel(value: WorkspaceFolder['syncTargets'][number]) {
  return value === 'local' ? 'Local Cowork' : 'VPS'
}

export default function OrgSettingsPage() {
  const params = useParams()
  const slug = params.slug as string

  const [orgId, setOrgId] = useState('')
  const [orgName, setOrgName] = useState('')
  const [form, setForm] = useState<OrgForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [folderMappings, setFolderMappings] = useState<WorkspaceFolderWithId[]>([])
  const [workspaceConnections, setWorkspaceConnections] = useState<WorkspaceConnectionSummary[]>([])
  const [crmCompanies, setCrmCompanies] = useState<CrmCompanySummary[]>([])
  const [folderMappingForm, setFolderMappingForm] = useState<FolderMappingForm>(EMPTY_FOLDER_MAPPING_FORM)
  const [savingFolderMapping, setSavingFolderMapping] = useState(false)
  const [companySearch, setCompanySearch] = useState('')
  const [folderNotice, setFolderNotice] = useState('')
  const [resyncingFolderId, setResyncingFolderId] = useState<string | null>(null)
  const [preparingOauths, setPreparingOauths] = useState(false)
  const [preparingXMcp, setPreparingXMcp] = useState(false)

  function copyOrgId() {
    if (!orgId) return
    copyToClipboard(orgId).then(() => {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    })
  }

  useEffect(() => {
    async function load() {
      const orgsRes = await fetch('/api/v1/organizations')
      const orgsBody = await orgsRes.json()
      const orgs: OrgSummary[] = Array.isArray(orgsBody.data) ? orgsBody.data : []
      const org = orgs.find((o) => o.slug === slug)
      if (!org) { setLoading(false); return }

      setOrgId(org.id)
      setOrgName(org.name ?? '')

      const detailRes = await fetch(`/api/v1/organizations/${org.id}`, { headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug } })
      const detailBody = await detailRes.json()
      const d = detailBody.data
      const folderRes = await fetch(`/api/v1/workspace-folders?orgId=${encodeURIComponent(org.id)}`, { headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug } })
      const folderBody = await folderRes.json().catch(() => ({ data: { folders: [] } }))
      const folders = Array.isArray(folderBody.data?.folders) ? folderBody.data.folders : Array.isArray(folderBody.data) ? folderBody.data : []
      setFolderMappings(folders)
      const connectionRes = await fetch(`/api/v1/workspace-connections?orgId=${encodeURIComponent(org.id)}`, { headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug } })
      const connectionBody = await connectionRes.json().catch(() => ({ data: [] }))
      setWorkspaceConnections(Array.isArray(connectionBody.data) ? connectionBody.data : [])
      const companyRes = await fetch('/api/v1/crm/companies?limit=100&orderBy=name-asc', { headers: { 'X-Org-Id': org.id, 'X-Org-Slug': slug } })
      const companyBody = await companyRes.json().catch(() => ({ data: { companies: [] } }))
      setCrmCompanies(Array.isArray(companyBody.data?.companies) ? companyBody.data.companies : [])
      if (d) {
        const bd = d.billingDetails ?? {}
        const addr = bd.address ?? {}
        const bank = bd.bankingDetails ?? {}
        const settings = d.settings ?? {}
        const portalModules = settings.portalModules && typeof settings.portalModules === 'object'
          ? settings.portalModules as Record<string, boolean>
          : {}
        setForm({
          name: d.name ?? '',
          website: d.website ?? '',
          description: d.description ?? '',
          industry: d.industry ?? '',
          billingEmail: d.billingEmail ?? '',
          status: d.status ?? 'active',
          notificationEmail: settings.notificationEmail ?? '',
          defaultApprovalRequired: settings.defaultApprovalRequired ?? false,
          timezone: settings.timezone ?? d.timezone ?? 'Africa/Johannesburg',
          currency: ['USD', 'EUR', 'ZAR'].includes(settings.currency)
            ? settings.currency
            : 'ZAR',
          portalModules,
          portalMobileApps: portalModules.mobileApps !== false,
          portalYouTubeStudio: portalModules.youtubeStudio !== false,
          portalBookStudio: portalModules.bookStudio === true,
          preferredSendHourLocal:
            typeof settings.preferredSendHourLocal === 'number'
              ? settings.preferredSendHourLocal
              : 9,
          preferredSendDaysOfWeek: Array.isArray(settings.preferredSendDaysOfWeek)
            ? settings.preferredSendDaysOfWeek
            : [1, 2, 3, 4, 5],
          replyNotifyEmails: Array.isArray(settings.replyNotifyEmails)
            ? settings.replyNotifyEmails.join(', ')
            : '',
          line1: addr.line1 ?? '',
          line2: addr.line2 ?? '',
          city: addr.city ?? '',
          state: addr.state ?? '',
          postalCode: addr.postalCode ?? '',
          country: addr.country ?? '',
          legalName: bd.legalName ?? '',
          tradingName: bd.tradingName ?? '',
          vatNumber: bd.vatNumber ?? '',
          registrationNumber: bd.registrationNumber ?? '',
          taxNumber: bd.taxNumber ?? '',
          phone: bd.phone ?? '',
          accountsContactName: bd.accountsContact?.name ?? '',
          accountsContactTitle: bd.accountsContact?.title ?? '',
          accountsContactEmail: bd.accountsContact?.email ?? '',
          accountsContactPhone: bd.accountsContact?.phone ?? '',
          authorizedSignatoryName: bd.authorizedSignatory?.name ?? '',
          authorizedSignatoryTitle: bd.authorizedSignatory?.title ?? '',
          authorizedSignatoryEmail: bd.authorizedSignatory?.email ?? '',
          authorizedSignatoryPhone: bd.authorizedSignatory?.phone ?? '',
          purchaseOrderRequired: bd.purchaseOrderRequired === true,
          purchaseOrderNumber: bd.purchaseOrderNumber ?? '',
          invoiceInstructions: bd.invoiceInstructions ?? '',
          bankName: bank.bankName ?? '',
          accountHolder: bank.accountHolder ?? '',
          accountNumber: bank.accountNumber ?? '',
          branchCode: bank.branchCode ?? '',
          routingNumber: bank.routingNumber ?? '',
          swiftCode: bank.swiftCode ?? '',
          iban: bank.iban ?? '',
        })
      }
      setLoading(false)
    }
    if (slug) load()
  }, [slug])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)

    await fetch(`/api/v1/organizations/${orgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId, 'X-Org-Slug': slug },
      body: JSON.stringify({
        name: form.name,
        website: form.website,
        description: form.description,
        industry: form.industry,
        billingEmail: form.billingEmail,
        status: form.status,
        settings: {
          notificationEmail: form.notificationEmail,
          defaultApprovalRequired: form.defaultApprovalRequired,
          timezone: form.timezone,
          currency: form.currency,
          preferredSendHourLocal: form.preferredSendHourLocal,
          preferredSendDaysOfWeek: form.preferredSendDaysOfWeek,
          portalModules: {
            ...form.portalModules,
            mobileApps: form.portalMobileApps,
            youtubeStudio: form.portalYouTubeStudio,
            bookStudio: form.portalBookStudio,
          },
          replyNotifyEmails: form.replyNotifyEmails
            .split(/[\s,]+/)
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e && e.includes('@')),
        },
        billingDetails: {
          address: {
            line1: form.line1,
            line2: form.line2,
            city: form.city,
            state: form.state,
            postalCode: form.postalCode,
            country: form.country,
          },
          legalName: form.legalName,
          tradingName: form.tradingName,
          vatNumber: form.vatNumber,
          registrationNumber: form.registrationNumber,
          taxNumber: form.taxNumber,
          phone: form.phone,
          accountsContact: {
            name: form.accountsContactName,
            title: form.accountsContactTitle,
            email: form.accountsContactEmail,
            phone: form.accountsContactPhone,
          },
          authorizedSignatory: {
            name: form.authorizedSignatoryName,
            title: form.authorizedSignatoryTitle,
            email: form.authorizedSignatoryEmail,
            phone: form.authorizedSignatoryPhone,
          },
          purchaseOrderRequired: form.purchaseOrderRequired,
          purchaseOrderNumber: form.purchaseOrderNumber,
          invoiceInstructions: form.invoiceInstructions,
          bankingDetails: {
            bankName: form.bankName,
            accountHolder: form.accountHolder,
            accountNumber: form.accountNumber,
            branchCode: form.branchCode,
            routingNumber: form.routingNumber,
            swiftCode: form.swiftCode,
            iban: form.iban,
          },
        },
      }),
    })

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function update<K extends keyof OrgForm>(field: K, value: OrgForm[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleFolderResync(folder: WorkspaceFolderWithId) {
    setResyncingFolderId(folder.id)
    setFolderNotice('')
    const res = await fetch(`/api/v1/workspace-folders/${folder.id}/resync?orgId=${encodeURIComponent(orgId)}`, { method: 'POST', headers: { 'X-Org-Id': orgId, 'X-Org-Slug': slug } })
    const body = await res.json().catch(() => ({}))
    setFolderNotice(body.data?.message ?? body.error ?? 'Sync plan request recorded.')
    if (res.ok && body.data?.syncState) {
      setFolderMappings(current => current.map(item => item.id === folder.id
        ? { ...item, syncState: body.data.syncState }
        : item))
    }
    setResyncingFolderId(null)
  }


  function updateFolderMappingForm<K extends keyof FolderMappingForm>(field: K, value: FolderMappingForm[K]) {
    setFolderMappingForm(prev => ({ ...prev, [field]: value }))
  }

  async function refreshFolderMappings(currentOrgId = orgId) {
    if (!currentOrgId) return
    const folderRes = await fetch(`/api/v1/workspace-folders?orgId=${encodeURIComponent(currentOrgId)}`, { headers: { 'X-Org-Id': currentOrgId, 'X-Org-Slug': slug } })
    const folderBody = await folderRes.json().catch(() => ({ data: { folders: [] } }))
    const folders = Array.isArray(folderBody.data?.folders) ? folderBody.data.folders : Array.isArray(folderBody.data) ? folderBody.data : []
    setFolderMappings(folders)
  }

  async function handleAddFolderMapping(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || savingFolderMapping) return
    setSavingFolderMapping(true)
    setFolderNotice('')
    try {
      const driveFolderId = parseDriveFolderId(folderMappingForm.driveFolderUrl)
      if (!driveFolderId) throw new Error('Paste a valid Google Drive folder URL or folder ID.')
      if (folderMappingForm.scope === 'crm_company' && !folderMappingForm.companyId) {
        throw new Error('Choose the CRM company this Drive folder belongs to.')
      }
      const isDriveUrl = /^https?:\/\//i.test(folderMappingForm.driveFolderUrl.trim())
      const selectedCompany = crmCompanies.find((company) => company.id === folderMappingForm.companyId)
      const payload = {
        orgId,
        name: folderMappingForm.name.trim() || (folderMappingForm.scope === 'crm_company' && selectedCompany?.name ? `${selectedCompany.name} Drive folder` : 'Workspace Drive folder'),
        resourceType: folderMappingForm.scope === 'crm_company' ? 'crm_company' : null,
        resourceId: folderMappingForm.scope === 'crm_company' ? folderMappingForm.companyId : null,
        visibility: folderMappingForm.visibility,
        driveFolderId,
        driveFolderUrl: isDriveUrl ? folderMappingForm.driveFolderUrl.trim() : `https://drive.google.com/drive/folders/${driveFolderId}`,
        sourceOfTruth: 'google_drive',
        syncMode: 'metadata_only',
        syncTargets: [],
        tags: ['drive', 'research', 'notebooklm'],
        audit: {
          auditStatus: 'pending_drive_acl_review',
          riskLevel: folderMappingForm.visibility === 'admin_agents_clients' ? 'medium' : 'low',
          notes: 'PiB app visibility controls app/agent access only. Review Google Drive sharing separately before client exposure.',
        },
        safeMetadata: {
          createdFrom: 'admin_org_settings_drive_mapping_form',
          linkedCompanyName: selectedCompany?.name ?? null,
          driveAclRequiresSeparateReview: true,
        },
      }
      const res = await fetch('/api/v1/workspace-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId, 'X-Org-Slug': slug },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to save Drive folder mapping.')
      setFolderMappingForm(EMPTY_FOLDER_MAPPING_FORM)
      setCompanySearch('')
      await refreshFolderMappings()
      setFolderNotice('Drive folder mapping saved. Review Drive sharing separately before making it client-visible.')
    } catch (err) {
      setFolderNotice(err instanceof Error ? err.message : 'Failed to save Drive folder mapping.')
    } finally {
      setSavingFolderMapping(false)
    }
  }

  const requiredWorkspaceOauths = useMemo(() => REQUIRED_WORKSPACE_OAUTHS.map((oauth) => {
    const keys = new Set<string>([oauth.key, ...oauth.aliases])
    const existing = workspaceConnections.find((connection) => connection.connectionKey ? keys.has(connection.connectionKey) : false)
    return { ...oauth, existing }
  }), [workspaceConnections])

  const missingWorkspaceOauthCount = requiredWorkspaceOauths.filter((oauth) => !oauth.existing).length
  const googleWorkspaceAuthorizeKey = requiredWorkspaceOauths[0]?.existing?.connectionKey ?? UNIFIED_GOOGLE_WORKSPACE_CONNECTION_KEY
  const xMcpConnection = workspaceConnections.find((connection) => connection.provider === 'x_mcp' && connection.connectionKey === X_MCP_CONNECTION_KEY)
  const filteredCrmCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase()
    if (!query) return crmCompanies
    return crmCompanies.filter((company) => `${company.name ?? ''} ${company.domain ?? ''} ${company.id}`.toLowerCase().includes(query))
  }, [companySearch, crmCompanies])

  async function refreshWorkspaceConnections(currentOrgId = orgId) {
    if (!currentOrgId) return
    const res = await fetch(`/api/v1/workspace-connections?orgId=${encodeURIComponent(currentOrgId)}`, { headers: { 'X-Org-Id': currentOrgId, 'X-Org-Slug': slug } })
    const body = await res.json().catch(() => ({ data: [] }))
    setWorkspaceConnections(Array.isArray(body.data) ? body.data : [])
  }

  async function prepareRequiredWorkspaceOauths() {
    if (!orgId || preparingOauths) return
    setPreparingOauths(true)
    setFolderNotice('')
    try {
      const missing = requiredWorkspaceOauths.filter((oauth) => !oauth.existing)
      for (const oauth of missing) {
        const res = await fetch('/api/v1/workspace-connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId, 'X-Org-Slug': slug },
          body: JSON.stringify({
            orgId,
            connectionKey: oauth.key,
            displayName: oauth.displayName,
            provider: 'google_workspace',
            connectionType: 'user_oauth',
            status: 'proposed',
            automationIdentity: 'peet',
            capabilityScopes: oauth.capabilityScopes,
            capabilities: oauth.capabilities,
            scopes: GOOGLE_WORKSPACE_OAUTH_SCOPES,
            tokenStatus: 'needs_authorization',
            reconnectInstructions: 'Use the Authorize Google Workspace button from this settings page. The OAuth callback links the encrypted mailbox credential store to this registry record without exposing raw tokens.',
            riskLevel: 'high',
            approvalStatus: 'pending',
            dataTouched: ['google_drive', 'google_docs', 'google_sheets', 'gmail', 'google_calendar', 'workspace_artifacts'],
            safeMetadata: {
              setupSurface: 'admin_org_settings_workspace_folder_registry',
              sourceOfTruth: 'google_drive',
              portalExposure: 'deferred_until_folder_visibility_review',
            },
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? `Failed to create ${oauth.displayName}`)
      }
      await refreshWorkspaceConnections()
      setFolderNotice(missing.length > 0
        ? `Prepared ${missing.length} Google Workspace OAuth registry record${missing.length === 1 ? '' : 's'}. Start the Google OAuth flow, then add folder mappings.`
        : 'All required Google Workspace OAuth registry records are already prepared.')
    } catch (err) {
      setFolderNotice(err instanceof Error ? err.message : 'Failed to prepare OAuth records.')
    } finally {
      setPreparingOauths(false)
    }
  }

  async function prepareXMcpConnection() {
    if (!orgId || preparingXMcp || xMcpConnection) return
    setPreparingXMcp(true)
    setFolderNotice('')
    try {
      const res = await fetch('/api/v1/workspace-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId, 'X-Org-Slug': slug },
        body: JSON.stringify({
          orgId,
          connectionKey: X_MCP_CONNECTION_KEY,
          displayName: 'Personal X MCP account',
          provider: 'x_mcp',
          connectionType: 'user_oauth',
          status: 'proposed',
          capabilityScopes: [...X_MCP_CAPABILITY_SCOPES],
          capabilities: {
            xPostsRead: true,
            xSearchRead: true,
            xUsersRead: true,
            xBookmarksRead: true,
            xBookmarksWrite: true,
            xNewsRead: true,
            xArticlesWrite: true,
          },
          scopes: [...X_MCP_SCOPE_ROWS],
          tokenStatus: 'user_authorization_required',
          reconnectInstructions: `Use xurl with the hosted Streamable HTTP MCP server at ${X_MCP_CLIENT_CONFIG.streamableHttpServer}. Each user authorizes their own X account; PiB stores registry metadata only, not bearer or refresh tokens.`,
          riskLevel: 'high',
          approvalStatus: 'pending',
          dataTouched: ['x_posts', 'x_search', 'x_users', 'x_bookmarks', 'x_news', 'x_articles'],
          safeMetadata: {
            setupSurface: 'admin_org_settings_x_mcp_registry',
            perUserAccount: true,
            sharedPlatformTokenStored: false,
            docsMcpServer: X_MCP_CLIENT_CONFIG.docsServer,
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to prepare personal X MCP connection.')
      await refreshWorkspaceConnections()
      setFolderNotice('Prepared a personal X MCP registry record. The MCP client still needs the user to authorize X through xurl before agents can use that user’s X permissions.')
    } catch (err) {
      setFolderNotice(err instanceof Error ? err.message : 'Failed to prepare personal X MCP connection.')
    } finally {
      setPreparingXMcp(false)
    }
  }

  if (loading) return <div className="pib-skeleton h-96 max-w-3xl mx-auto" />

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow={`${orgName || slug} · Settings`}
        title="Organisation Settings"
        description="Workspace identity, portal modules, folder registry, and billing details for this organisation."
      />

      {/* Org ID */}
      {orgId && (
        <div className="pib-card-section">
          <div className="pib-card-section-header">
            <span className="pib-label">Organisation ID</span>
          </div>
          <div className="pib-card-section-row">
            <span className="text-sm text-[var(--color-pib-text-muted)]">Org ID</span>
            <span className="flex items-center gap-2">
              <code className="font-mono text-xs text-[var(--color-pib-text)] bg-[var(--color-pib-surface-2)] px-2 py-1 rounded select-all">{orgId}</code>
              <button type="button" onClick={copyOrgId} className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors px-2 py-1 rounded hover:bg-[var(--color-pib-surface-2)]">
                {copiedId ? 'Copied!' : 'Copy'}
              </button>
            </span>
          </div>
          <div className="px-4 pb-3">
            <p className="text-[11px] text-[var(--color-pib-text-faint)]">Use this ID when configuring AI agents or API integrations for this organisation.</p>
          </div>
        </div>
      )}

      <div className="pib-card-section">
        <div className="pib-card-section-header flex items-start justify-between gap-4">
          <div>
            <span className="pib-label">Workspace folder registry</span>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Map multiple Google Drive folders to each workspace/resource. PiB visibility controls what admins, agents, and clients can see; Drive ACLs remain the binary asset source-of-truth guardrail.
            </p>
          </div>
          <span className="rounded-md bg-[var(--color-pib-surface-2)] px-3 py-1 text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">
            Portal exposure deferred
          </span>
        </div>
        <div className="border-t border-[var(--color-pib-line)]/50 p-4">
          <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-accent-soft)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Required Google OAuth setup</h2>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  Prepare the workspace OAuth records admins need before adding Drive folders. The buttons do not expose raw tokens; they create auditable registry records and start the approved Google authorization flow.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={prepareRequiredWorkspaceOauths}
                  disabled={preparingOauths || missingWorkspaceOauthCount === 0}
                  className="btn-pib-primary btn-pib-sm"
                >
                  {preparingOauths ? 'Preparing…' : missingWorkspaceOauthCount > 0 ? `Prepare ${missingWorkspaceOauthCount} OAuth${missingWorkspaceOauthCount === 1 ? '' : 's'}` : 'OAuth records ready'}
                </button>
                <a
                  href={orgId ? `/api/v1/workspace-connections/google/authorize?orgId=${encodeURIComponent(orgId)}&connectionKey=${encodeURIComponent(googleWorkspaceAuthorizeKey)}&returnTo=${encodeURIComponent(`/admin/org/${slug}/settings`)}` : '/api/v1/workspace-connections/google/authorize'}
                  className="btn-pib-secondary btn-pib-sm"
                >
                  Authorize Google Workspace
                </a>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {requiredWorkspaceOauths.map((oauth) => (
                <div key={oauth.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-pib-line)]/50 bg-[var(--color-pib-surface)] px-3 py-2 text-xs">
                  <div>
                    <p className="font-medium text-[var(--color-pib-text)]">{oauth.displayName}</p>
                    <p className="mt-0.5 text-[var(--color-pib-text-muted)]">{oauth.description}</p>
                  </div>
                  <span className={oauth.existing ? "pib-pill pib-pill-success" : "pib-pill pib-pill-warn"}>
                    {oauth.existing ? `${oauth.existing.status ?? 'proposed'} · ${oauth.existing.tokenStatus ?? 'token pending'}` : 'Not prepared'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--color-pib-line)]/50 p-4">
          <div className="rounded-md border border-[var(--color-pib-line)]/60 bg-[var(--color-pib-surface-2)]/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Personal X MCP account</h2>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  Register the hosted X MCP as a per-user connection so agents can work with the signed-in user’s own X permissions, including bookmarks, searches, posts, news, and article drafts. PiB stores setup metadata only; xurl handles OAuth and token refresh in the user’s MCP client. This admin card is a fallback; users should normally start from Portal → Personal → Accounts.
                </p>
              </div>
              <span className={xMcpConnection ? "pib-pill pib-pill-success" : "pib-pill pib-pill-warn"}>
                {xMcpConnection ? `${xMcpConnection.status ?? 'proposed'} · ${xMcpConnection.tokenStatus ?? 'authorization pending'}` : 'Not prepared'}
              </span>
            </div>
            <div className="mt-3 grid gap-2 rounded-lg border border-[var(--color-pib-line)]/50 bg-[var(--color-pib-surface)] p-3 text-xs text-[var(--color-pib-text-muted)]">
              <p><span className="font-medium text-[var(--color-pib-text)]">Server:</span> {X_MCP_CLIENT_CONFIG.streamableHttpServer}</p>
              <p><span className="font-medium text-[var(--color-pib-text)]">Client command:</span> <code className="rounded bg-[var(--color-pib-surface-2)] px-1 py-0.5">{X_MCP_CLIENT_CONFIG.command}</code></p>
              <p><span className="font-medium text-[var(--color-pib-text)]">Docs MCP:</span> {X_MCP_CLIENT_CONFIG.docsServer}</p>
              <p><span className="font-medium text-[var(--color-pib-text)]">Startup timeout:</span> {X_MCP_CLIENT_CONFIG.startupTimeoutSeconds}s minimum so the one-time OAuth browser login can finish.</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={prepareXMcpConnection}
                disabled={preparingXMcp || Boolean(xMcpConnection)}
                className="btn-pib-primary btn-pib-sm"
              >
                {preparingXMcp ? 'Preparing…' : xMcpConnection ? 'X MCP record ready' : 'Prepare personal X MCP'}
              </button>
              <a href="https://docs.x.com/tools/mcp" className="btn-pib-secondary btn-pib-sm" target="_blank" rel="noreferrer">
                Open X MCP docs
              </a>
            </div>
          </div>
        </div>
        <form onSubmit={handleAddFolderMapping} className="border-t border-[var(--color-pib-line)]/50 p-4">
          <div className="rounded-md border border-[var(--color-pib-line)]/60 bg-[var(--color-pib-surface-2)]/30 p-4">
            <div className="mb-4">
              <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Add Drive folder mapping</h2>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Paste a Google Drive folder URL, choose whether it belongs to the selected workspace or a CRM company, and keep app visibility separate from Drive sharing.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="folderMappingName" className="pib-label">Mapping name</label>
                <input id="folderMappingName" value={folderMappingForm.name} onChange={e => updateFolderMappingForm('name', e.target.value)} className="pib-input" placeholder="NotebookLM research assets" />
              </div>
              <div>
                <label htmlFor="folderMappingUrl" className="pib-label">Drive folder URL or ID</label>
                <input id="folderMappingUrl" value={folderMappingForm.driveFolderUrl} onChange={e => updateFolderMappingForm('driveFolderUrl', e.target.value)} className="pib-input" placeholder="https://drive.google.com/drive/folders/..." />
              </div>
              <div>
                <label htmlFor="folderMappingScope" className="pib-label">Mapping scope</label>
                <select id="folderMappingScope" value={folderMappingForm.scope} onChange={e => updateFolderMappingForm('scope', e.target.value as FolderMappingForm['scope'])} className="pib-select">
                  <option value="workspace">Workspace / org-level folder</option>
                  <option value="crm_company">CRM company folder</option>
                </select>
              </div>
              <div>
                <label htmlFor="folderMappingCompanySearch" className="pib-label">Search CRM companies</label>
                <input id="folderMappingCompanySearch" value={companySearch} onChange={e => setCompanySearch(e.target.value)} disabled={folderMappingForm.scope !== 'crm_company'} className="pib-input" placeholder="Search by company name" />
              </div>
              <div>
                <label htmlFor="folderMappingCompany" className="pib-label">CRM company</label>
                <select id="folderMappingCompany" value={folderMappingForm.companyId} onChange={e => updateFolderMappingForm('companyId', e.target.value)} disabled={folderMappingForm.scope !== 'crm_company'} className="pib-select">
                  <option value="">{folderMappingForm.scope === 'crm_company' ? 'Choose company…' : 'Not required for workspace scope'}</option>
                  {filteredCrmCompanies.map(company => <option key={company.id} value={company.id}>{company.name || company.id}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="folderMappingVisibility" className="pib-label">App visibility</label>
                <select id="folderMappingVisibility" value={folderMappingForm.visibility} onChange={e => updateFolderMappingForm('visibility', e.target.value as WorkspaceFolder['visibility'])} className="pib-select">
                  <option value="admin_agents">Admin + agents (safe default)</option>
                  <option value="admin_only">Admin only</option>
                  <option value="admin_agents_clients">Client-visible: admin + agents + clients</option>
                </select>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={savingFolderMapping} className="btn-pib-primary btn-pib-sm">
                  {savingFolderMapping ? 'Saving…' : 'Add Drive folder mapping'}
                </button>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-[var(--color-pib-text-muted)]">Default for NotebookLM and research assets is Admin + agents. Selecting client-visible only changes PiB app access; Google Drive ACLs must still be reviewed in Drive.</p>
          </div>
        </form>
        <div className="divide-y divide-[var(--color-pib-line)]">
          {folderMappings.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">
              No folder mappings yet. Use the form above to add a workspace or CRM company Drive folder mapping.
            </div>
          ) : folderMappings.map(folder => (
            <div key={folder.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium text-[var(--color-pib-text)]">{folder.name}</h2>
                    <span className="rounded-md pib-pill pib-pill-cyan">{folder.resourceType || 'workspace'}</span>
                    {folder.resourceId && <span className="text-[11px] text-[var(--color-pib-text-muted)]">Linked ID: {folder.resourceId}</span>}
                    {folder.resourceType === 'crm_company' && <span className="text-[11px] text-[var(--color-pib-text-muted)]">Company: {crmCompanies.find(company => company.id === folder.resourceId)?.name || folder.resourceId}</span>}
                    {folder.parentId && <span className="text-[11px] text-[var(--color-pib-text-muted)]">Parent: {folder.parentId}</span>}
                  </div>
                  <p className="mt-1 flex flex-wrap gap-1 text-xs text-[var(--color-pib-text-muted)]">
                    <span>{folderVisibilityLabel(folder.visibility)}</span>
                    <span>·</span>
                    <span>{folderSourceOfTruthLabel(folder.sourceOfTruth)}</span>
                    <span>·</span>
                    <span>{folderSyncModeLabel(folder.syncMode)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleFolderResync(folder)}
                  disabled={resyncingFolderId === folder.id}
                  className="btn-pib-secondary btn-pib-sm"
                  aria-label={`Resync ${folder.name}`}
                >
                  {resyncingFolderId === folder.id ? 'Planning…' : 'Create sync plan'}
                </button>
              </div>
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Drive</p>
                  <p className="mt-1 break-all text-[var(--color-pib-text)]">{folder.drive.folderId || 'No Drive ID set'}</p>
                  {folder.drive.folderUrl && <a className="mt-1 inline-block break-all text-[var(--color-pib-accent)] hover:underline" href={folder.drive.folderUrl} target="_blank" rel="noreferrer">{folder.drive.folderUrl}</a>}
                </div>
                <div>
                  <p className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Sync / audit</p>
                  <p className="mt-1 text-[var(--color-pib-text)]">Status: {folder.syncState.status} · Conflicts: {folder.audit.conflictStatus}</p>
                  {folder.syncState.lastRequestId && (
                    <p className="mt-1 break-all text-[var(--color-pib-text-muted)]">Latest request: {folder.syncState.lastRequestStatus ?? 'planned'} · {folder.syncState.lastRequestId}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1 text-[var(--color-pib-text-muted)]">
                    <span>Targets:</span>
                    {folder.syncTargets.length ? folder.syncTargets.map(target => <span key={target}>{folderSyncTargetLabel(target)}</span>) : <span>Not configured</span>}
                  </div>
                </div>
                <div>
                  <p className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Path hints</p>
                  <p className="mt-1 text-[var(--color-pib-text-muted)]">VPS: {folder.paths.vpsPath || ' - '}</p>
                  <p className="text-[var(--color-pib-text-muted)]">Local: {folder.paths.localPathHint || ' - '}</p>
                </div>
                <div>
                  <p className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Tags / permissions</p>
                  <p className="mt-1 text-[var(--color-pib-text-muted)]">{folder.tags.length ? folder.tags.join(', ') : 'No tags'}</p>
                  <p className="mt-1 text-[var(--color-pib-text-muted)]">{folder.audit.notes || 'Hybrid permission model: PiB roles gate app/agent access; Drive permissions must be reviewed before adding clients.'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {folderNotice && <div className="border-t border-[var(--color-pib-line)]/50 p-4 text-sm text-[var(--color-pib-green)]">{folderNotice}</div>}
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* General Settings */}
        <div className="pib-card space-y-4">
          <p className="pib-label">General</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fld-organisation-name" className="pib-label">Organisation Name</label>
              <input id="fld-organisation-name" aria-label="Organisation Name" value={form.name} onChange={e => update('name', e.target.value)} className="pib-input" placeholder="Acme Corp" />
            </div>
            <div>
              <label htmlFor="fld-website" className="pib-label">Website</label>
              <input id="fld-website" aria-label="Website" value={form.website} onChange={e => update('website', e.target.value)} className="pib-input" placeholder="https://acme.com" />
            </div>
            <div className="col-span-2">
              <label htmlFor="fld-description" className="pib-label">Description</label>
              <textarea id="fld-description" aria-label="Description" value={form.description} onChange={e => update('description', e.target.value)} className="pib-textarea" rows={3} placeholder="Brief description of the organisation" />
            </div>
            <div>
              <label htmlFor="fld-industry" className="pib-label">Industry</label>
              <input id="fld-industry" aria-label="Industry" value={form.industry} onChange={e => update('industry', e.target.value)} className="pib-input" placeholder="e.g. Technology" />
            </div>
            <div>
              <label htmlFor="fld-status" className="pib-label">Status</label>
              <select id="fld-status" aria-label="Status" value={form.status} onChange={e => update('status', e.target.value)} className="pib-select">
                <option value="active">Active</option>
                <option value="onboarding">Onboarding</option>
                <option value="suspended">Suspended</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label htmlFor="fld-billing-email" className="pib-label">Billing Email</label>
              <input id="fld-billing-email" aria-label="Billing Email" type="email" value={form.billingEmail} onChange={e => update('billingEmail', e.target.value)} className="pib-input" placeholder="billing@company.com" />
            </div>
            <div>
              <label htmlFor="fld-notification-email" className="pib-label">Notification Email</label>
              <input id="fld-notification-email" aria-label="Notification Email" type="email" value={form.notificationEmail} onChange={e => update('notificationEmail', e.target.value)} className="pib-input" placeholder="notify@company.com" />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <input
                id="defaultApproval"
                type="checkbox"
                checked={form.defaultApprovalRequired}
                onChange={e => update('defaultApprovalRequired', e.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-pib-line)] text-primary"
              />
              <label htmlFor="defaultApproval" className="pib-label mb-0 cursor-pointer">
                Require approval by default for new content
              </label>
            </div>
            <div>
              <label htmlFor="fld-timezone" className="pib-label">Timezone</label>
              <select id="fld-timezone" aria-label="Timezone" value={form.timezone} onChange={e => update('timezone', e.target.value)} className="pib-select">
                <option value="Africa/Johannesburg">Africa/Johannesburg (SAST, UTC+2)</option>
                <option value="America/Chicago">America/Chicago (CST, UTC-6)</option>
                <option value="America/Denver">America/Denver (MST, UTC-7)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST, UTC-8)</option>
                <option value="America/New_York">America/New_York (EST, UTC-5)</option>
                <option value="America/Sao_Paulo">America/Sao_Paulo (BRT, UTC-3)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (CST, UTC+8)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST, UTC+9)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST, UTC+10)</option>
                <option value="Europe/Amsterdam">Europe/Amsterdam (CET, UTC+1)</option>
                <option value="Europe/London">Europe/London (GMT, UTC+0)</option>
                <option value="Europe/Paris">Europe/Paris (CET, UTC+1)</option>
                <option value="Pacific/Auckland">Pacific/Auckland (NZST, UTC+12)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div>
              <label htmlFor="fld-currency" className="pib-label">Currency</label>
              <select id="fld-currency" aria-label="Currency" value={form.currency} onChange={e => update('currency', e.target.value as OrgForm['currency'])} className="pib-select">
                <option value="ZAR">ZAR (R)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Client portal modules */}
        <div className="pib-card space-y-4">
          <div>
            <p className="pib-label">Client portal modules</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Choose which work areas this client can see in their portal. Disabled modules stay available to PiB admins.
            </p>
          </div>
          <label htmlFor="portalMobileApps" className="flex items-start gap-3 rounded-lg border border-[var(--color-pib-line)]/60 bg-[var(--color-pib-surface-2)]/40 p-4">
            <input
              id="portalMobileApps"
              type="checkbox"
              aria-label="Mobile Apps"
              checked={form.portalMobileApps}
              onChange={e => update('portalMobileApps', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-pib-line)] text-primary"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">Mobile Apps</span>
              <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">
                Show App Store and Google Play review links, release notes, and app feedback tools for this selected org only after PiB operator review.
              </span>
            </span>
          </label>
          <label htmlFor="portalYouTubeStudio" className="flex items-start gap-3 rounded-lg border border-[var(--color-pib-line)]/60 bg-[var(--color-pib-surface-2)]/40 p-4">
            <input
              id="portalYouTubeStudio"
              type="checkbox"
              aria-label="YouTube Studio"
              checked={form.portalYouTubeStudio}
              onChange={e => update('portalYouTubeStudio', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-pib-line)] text-primary"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">YouTube Studio</span>
              <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">
                Show channel video requests, draft reviews, publishing packet approvals, and client-safe YouTube analytics.
              </span>
            </span>
          </label>
          <label htmlFor="portalBookStudio" className="flex items-start gap-3 rounded-lg border border-[var(--color-pib-line)]/60 bg-[var(--color-pib-surface-2)]/40 p-4">
            <input
              id="portalBookStudio"
              type="checkbox"
              aria-label="Book Studio"
              checked={form.portalBookStudio}
              onChange={e => update('portalBookStudio', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-pib-line)] text-primary"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--color-pib-text)]">Book Studio</span>
              <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">
                Expose Book Studio for this selected org only after the approved Phase 1 runtime foundation is enabled. Disabled is the safe default.
              </span>
            </span>
          </label>
        </div>

        {/* Email send-time + reply notifications */}
        <div className="pib-card space-y-4">
          <p className="pib-label">Email send-time</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fld-preferred-send-hour-local" className="pib-label">Preferred send hour (local)</label>
              <select id="fld-preferred-send-hour-local" aria-label="Preferred send hour (local)"
                value={form.preferredSendHourLocal}
                onChange={e => update('preferredSendHourLocal', parseInt(e.target.value, 10))}
                className="pib-select"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--color-pib-text-faint)] mt-1">
                Sequence steps and broadcasts will target this hour in the recipient&apos;s local timezone.
              </p>
            </div>
            <div>
              <label className="pib-label">Preferred send days</label>
              <div className="flex gap-1 flex-wrap">
                {[
                  { v: 0, l: 'Sun' },
                  { v: 1, l: 'Mon' },
                  { v: 2, l: 'Tue' },
                  { v: 3, l: 'Wed' },
                  { v: 4, l: 'Thu' },
                  { v: 5, l: 'Fri' },
                  { v: 6, l: 'Sat' },
                ].map((d) => {
                  const active = form.preferredSendDaysOfWeek.includes(d.v)
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() =>
                        update(
                          'preferredSendDaysOfWeek',
                          active
                            ? form.preferredSendDaysOfWeek.filter((x) => x !== d.v)
                            : [...form.preferredSendDaysOfWeek, d.v].sort(),
                        )
                      }
                      className={`px-2.5 py-1 rounded-md text-xs ${active ? "bg-[var(--color-pib-accent)] text-[var(--color-pib-ink)]" : "bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)]"}`}
                    >
                      {d.l}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-[var(--color-pib-text-faint)] mt-1">
                Steps that fall on excluded days roll forward to the next allowed day.
              </p>
            </div>
            <div className="col-span-2">
              <label htmlFor="fld-reply-notification-recipients" className="pib-label">Reply notification recipients</label>
              <input id="fld-reply-notification-recipients" aria-label="Reply notification recipients"
                value={form.replyNotifyEmails}
                onChange={e => update('replyNotifyEmails', e.target.value)}
                className="pib-input"
                placeholder="sales@company.com, growth@company.com"
              />
              <p className="text-[11px] text-[var(--color-pib-text-faint)] mt-1">
                Comma-separated. These addresses get notified whenever a contact replies (or bounces / unsubscribes via reply).
              </p>
            </div>
          </div>
        </div>

        {/* Billing Address */}
        <div className="pib-card space-y-4">
          <p className="pib-label">Billing Address</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label htmlFor="fld-street-address" className="pib-label">Street Address</label>
              <input id="fld-street-address" aria-label="Street Address" value={form.line1} onChange={e => update('line1', e.target.value)} className="pib-input" placeholder="123 Main Street" />
            </div>
            <div className="col-span-2">
              <label htmlFor="fld-address-line-2" className="pib-label">Address Line 2</label>
              <input id="fld-address-line-2" aria-label="Address Line 2" value={form.line2} onChange={e => update('line2', e.target.value)} className="pib-input" placeholder="Suite 100 (optional)" />
            </div>
            <div>
              <label htmlFor="fld-city" className="pib-label">City</label>
              <input id="fld-city" aria-label="City" value={form.city} onChange={e => update('city', e.target.value)} className="pib-input" placeholder="Cape Town" />
            </div>
            <div>
              <label htmlFor="fld-state-province" className="pib-label">State / Province</label>
              <input id="fld-state-province" aria-label="State / Province" value={form.state} onChange={e => update('state', e.target.value)} className="pib-input" placeholder="Western Cape" />
            </div>
            <div>
              <label htmlFor="fld-postal-code" className="pib-label">Postal Code</label>
              <input id="fld-postal-code" aria-label="Postal Code" value={form.postalCode} onChange={e => update('postalCode', e.target.value)} className="pib-input" placeholder="8001" />
            </div>
            <div>
              <label htmlFor="fld-country" className="pib-label">Country</label>
              <input id="fld-country" aria-label="Country" value={form.country} onChange={e => update('country', e.target.value)} className="pib-input" placeholder="South Africa" />
            </div>
          </div>
        </div>

        {/* Company Details */}
        <div className="pib-card space-y-4">
          <p className="pib-label">Company Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fld-legal-company-name" className="pib-label">Legal Company Name</label>
              <input id="fld-legal-company-name" aria-label="Legal Company Name" value={form.legalName} onChange={e => update('legalName', e.target.value)} className="pib-input" placeholder="Acme (Pty) Ltd" />
            </div>
            <div>
              <label htmlFor="fld-trading-name" className="pib-label">Trading Name</label>
              <input id="fld-trading-name" aria-label="Trading Name" value={form.tradingName} onChange={e => update('tradingName', e.target.value)} className="pib-input" placeholder="Acme" />
            </div>
            <div>
              <label htmlFor="fld-phone" className="pib-label">Phone</label>
              <input id="fld-phone" aria-label="Phone" value={form.phone} onChange={e => update('phone', e.target.value)} className="pib-input" placeholder="+27 21 000 0000" />
            </div>
            <div>
              <label htmlFor="fld-vat-number" className="pib-label">VAT Number</label>
              <input id="fld-vat-number" aria-label="VAT Number" value={form.vatNumber} onChange={e => update('vatNumber', e.target.value)} className="pib-input" placeholder="4000000000" />
            </div>
            <div>
              <label htmlFor="fld-registration-number" className="pib-label">Registration Number</label>
              <input id="fld-registration-number" aria-label="Registration Number" value={form.registrationNumber} onChange={e => update('registrationNumber', e.target.value)} className="pib-input" placeholder="2020/000000/07" />
            </div>
            <div>
              <label htmlFor="fld-tax-number" className="pib-label">Tax Number</label>
              <input id="fld-tax-number" aria-label="Tax Number" value={form.taxNumber} onChange={e => update('taxNumber', e.target.value)} className="pib-input" placeholder="Income tax number" />
            </div>
          </div>
        </div>

        {/* Agreement Contacts */}
        <div className="pib-card space-y-4">
          <p className="pib-label">Agreement Contacts</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fld-accounts-contact-name" className="pib-label">Accounts Contact Name</label>
              <input id="fld-accounts-contact-name" aria-label="Accounts Contact Name" value={form.accountsContactName} onChange={e => update('accountsContactName', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-accounts-contact-title" className="pib-label">Accounts Contact Title</label>
              <input id="fld-accounts-contact-title" aria-label="Accounts Contact Title" value={form.accountsContactTitle} onChange={e => update('accountsContactTitle', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-accounts-contact-email" className="pib-label">Accounts Contact Email</label>
              <input id="fld-accounts-contact-email" aria-label="Accounts Contact Email" type="email" value={form.accountsContactEmail} onChange={e => update('accountsContactEmail', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-accounts-contact-phone" className="pib-label">Accounts Contact Phone</label>
              <input id="fld-accounts-contact-phone" aria-label="Accounts Contact Phone" value={form.accountsContactPhone} onChange={e => update('accountsContactPhone', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-authorised-signatory-name" className="pib-label">Authorised Signatory Name</label>
              <input id="fld-authorised-signatory-name" aria-label="Authorised Signatory Name" value={form.authorizedSignatoryName} onChange={e => update('authorizedSignatoryName', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-authorised-signatory-title" className="pib-label">Authorised Signatory Title</label>
              <input id="fld-authorised-signatory-title" aria-label="Authorised Signatory Title" value={form.authorizedSignatoryTitle} onChange={e => update('authorizedSignatoryTitle', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-authorised-signatory-email" className="pib-label">Authorised Signatory Email</label>
              <input id="fld-authorised-signatory-email" aria-label="Authorised Signatory Email" type="email" value={form.authorizedSignatoryEmail} onChange={e => update('authorizedSignatoryEmail', e.target.value)} className="pib-input" />
            </div>
            <div>
              <label htmlFor="fld-authorised-signatory-phone" className="pib-label">Authorised Signatory Phone</label>
              <input id="fld-authorised-signatory-phone" aria-label="Authorised Signatory Phone" value={form.authorizedSignatoryPhone} onChange={e => update('authorizedSignatoryPhone', e.target.value)} className="pib-input" />
            </div>
          </div>
        </div>

        {/* Invoicing */}
        <div className="pib-card space-y-4">
          <p className="pib-label">Invoicing</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex items-center gap-3">
              <input
                id="purchaseOrderRequired"
                type="checkbox"
                checked={form.purchaseOrderRequired}
                onChange={e => update('purchaseOrderRequired', e.target.checked)}
                className="h-4 w-4 rounded border-[var(--color-pib-line)] text-primary"
              />
              <label htmlFor="purchaseOrderRequired" className="pib-label mb-0 cursor-pointer">
                Purchase order required
              </label>
            </div>
            <div>
              <label htmlFor="fld-purchase-order-number" className="pib-label">Purchase Order Number</label>
              <input id="fld-purchase-order-number" aria-label="Purchase Order Number" value={form.purchaseOrderNumber} onChange={e => update('purchaseOrderNumber', e.target.value)} className="pib-input" placeholder="PO-123" />
            </div>
            <div className="col-span-2">
              <label htmlFor="fld-invoice-instructions" className="pib-label">Invoice Instructions</label>
              <textarea id="fld-invoice-instructions" aria-label="Invoice Instructions" value={form.invoiceInstructions} onChange={e => update('invoiceInstructions', e.target.value)} className="pib-textarea" rows={3} placeholder="Any recurring invoice notes or routing requirements" />
            </div>
          </div>
        </div>

        {/* Banking Details */}
        <div className="pib-card space-y-4">
          <p className="pib-label">Banking Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fld-bank-name" className="pib-label">Bank Name</label>
              <input id="fld-bank-name" aria-label="Bank Name" value={form.bankName} onChange={e => update('bankName', e.target.value)} className="pib-input" placeholder="FNB" />
            </div>
            <div>
              <label htmlFor="fld-account-holder" className="pib-label">Account Holder</label>
              <input id="fld-account-holder" aria-label="Account Holder" value={form.accountHolder} onChange={e => update('accountHolder', e.target.value)} className="pib-input" placeholder="Partners in Biz (Pty) Ltd" />
            </div>
            <div>
              <label htmlFor="fld-account-number" className="pib-label">Account Number</label>
              <input id="fld-account-number" aria-label="Account Number" value={form.accountNumber} onChange={e => update('accountNumber', e.target.value)} className="pib-input" placeholder="62000000000" />
            </div>
            <div>
              <label htmlFor="fld-branch-code" className="pib-label">Branch Code</label>
              <input id="fld-branch-code" aria-label="Branch Code" value={form.branchCode} onChange={e => update('branchCode', e.target.value)} className="pib-input" placeholder="250655" />
            </div>
            <div>
              <label htmlFor="fld-routing-number" className="pib-label">Routing Number</label>
              <input id="fld-routing-number" aria-label="Routing Number" value={form.routingNumber} onChange={e => update('routingNumber', e.target.value)} className="pib-input" placeholder="Optional" />
            </div>
            <div>
              <label htmlFor="fld-swift-code" className="pib-label">SWIFT Code</label>
              <input id="fld-swift-code" aria-label="SWIFT Code" value={form.swiftCode} onChange={e => update('swiftCode', e.target.value)} className="pib-input" placeholder="FIRNZAJJ (optional)" />
            </div>
            <div>
              <label htmlFor="fld-iban" className="pib-label">IBAN</label>
              <input id="fld-iban" aria-label="IBAN" value={form.iban} onChange={e => update('iban', e.target.value)} className="pib-input" placeholder="Optional" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <button type="submit" disabled={saving} className="btn-pib-primary btn-pib-sm font-label">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && <span className="text-sm text-[var(--color-pib-green)]">Saved successfully</span>}
        </div>
      </form>
    </div>
  )
}

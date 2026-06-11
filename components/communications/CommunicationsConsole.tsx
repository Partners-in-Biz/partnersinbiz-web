'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageTabs } from '@/components/ui/AppFoundation'
import { useOrg } from '@/lib/contexts/OrgContext'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import type {
  CommunicationChannel,
  Conversation,
  ConversationMessage,
  HermesCommunicationSuggestion,
  MessageTemplate,
} from '@/lib/communications/types'

interface CommunicationsConsoleProps {
  mode: 'admin' | 'portal'
  initialOrgId?: string
  initialOrgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}

type ConsoleView = 'inbox' | 'templates' | 'campaigns' | 'automations' | 'channels' | 'analytics'
type InboxFilter = 'open' | 'unassigned' | 'mine' | 'pending' | 'resolved' | 'snoozed'

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

interface ConversationListResponse {
  items: Conversation[]
  total: number
}

interface ConversationBundle {
  conversation: Conversation
  messages: ConversationMessage[]
  contact?: Record<string, unknown> | null
  hermesSuggestion?: HermesCommunicationSuggestion
}

interface ChannelsResponse {
  providers: Array<{
    id: string
    name: string
    supports: CommunicationChannel[]
    readiness: {
      configured: boolean
      healthy: boolean
      missing: string[]
      checks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail?: string }>
    }
  }>
  accounts: unknown[]
  queues: unknown[]
  routingRules: unknown[]
}

const VIEW_LABELS: Array<{ id: ConsoleView; label: string; icon: string }> = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'templates', label: 'Templates', icon: 'view_quilt' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaign' },
  { id: 'automations', label: 'Automation', icon: 'account_tree' },
  { id: 'channels', label: 'Channels', icon: 'settings_input_antenna' },
  { id: 'analytics', label: 'Analytics', icon: 'query_stats' },
]

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  in_app: 'In-app',
  messenger: 'Messenger',
  instagram: 'Instagram',
}

const FILTER_LABELS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'mine', label: 'Mine' },
  { id: 'pending', label: 'Pending' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'snoozed', label: 'Snoozed' },
]

const FIELD_CLASS = 'w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]'

export function CommunicationsConsole({
  mode,
  initialOrgId = '',
  initialOrgSlug = '',
  sourceCompanyId = '',
  sourceCompanyName = '',
}: CommunicationsConsoleProps) {
  const { selectedOrgId, orgName, orgs } = useOrg()
  const [view, setView] = useState<ConsoleView>('inbox')
  const [filter, setFilter] = useState<InboxFilter>('open')
  const [channel, setChannel] = useState<CommunicationChannel | 'all'>('all')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bundle, setBundle] = useState<ConversationBundle | null>(null)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [channels, setChannels] = useState<ChannelsResponse | null>(null)
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalOrgId, setPortalOrgId] = useState('')
  const [portalOrgReady, setPortalOrgReady] = useState(mode !== 'portal')

  const requestedOrgId = initialOrgId.trim()
  const requestedOrgSlug = initialOrgSlug.trim()
  const sourceContext = {
    orgId: requestedOrgId || undefined,
    orgSlug: requestedOrgSlug || undefined,
    sourceCompanyId: sourceCompanyId.trim() || undefined,
    sourceCompanyName: sourceCompanyName.trim() || undefined,
  }
  const workspaceLabel = sourceContext.sourceCompanyName
    ? `${sourceContext.sourceCompanyName} workspace`
    : activeWorkspaceLabel(mode, requestedOrgSlug, requestedOrgId)
  const linkedOrg = requestedOrgSlug ? orgs.find((org) => org.slug === requestedOrgSlug) : undefined
  const activeOrgId = mode === 'portal'
    ? requestedOrgId || portalOrgId
    : requestedOrgId || linkedOrg?.id || selectedOrgId
  const activeOrgName = mode === 'portal'
    ? requestedOrgSlug || activeOrgId
    : linkedOrg?.name || (activeOrgId === selectedOrgId ? orgName : '') || activeOrgId

  const orgQuery = useMemo(() => {
    if (activeOrgId) return `orgId=${encodeURIComponent(activeOrgId)}`
    return ''
  }, [activeOrgId])

  const canLoad = Boolean(activeOrgId) && (mode === 'admin' || portalOrgReady)
  const marketingHref = mode === 'admin'
    ? '/portal/marketing'
    : scopedPortalPath('/portal/marketing', { ...sourceContext, orgId: activeOrgId, orgSlug: requestedOrgSlug })

  useEffect(() => {
    if (mode !== 'portal') return
    if (requestedOrgId) {
      setPortalOrgId(requestedOrgId)
      setPortalOrgReady(true)
      return
    }
    let cancelled = false
    setPortalOrgReady(false)
    fetch('/api/v1/portal/active-org', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled) return
        setPortalOrgId(typeof body?.orgId === 'string' ? body.orgId : '')
        setPortalOrgReady(true)
      })
      .catch(() => {
        if (!cancelled) setPortalOrgReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [mode, requestedOrgId])

  useEffect(() => {
    if (!canLoad) return
    void loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, orgQuery, filter, channel])

  useEffect(() => {
    if (!selectedId || !canLoad) {
      setBundle(null)
      return
    }
    void loadConversationBundle(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, canLoad, orgQuery])

  useEffect(() => {
    if (!canLoad) return
    if (view === 'templates') void loadTemplates()
    if (view === 'channels') void loadChannels()
    if (view === 'analytics') void loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, canLoad, orgQuery])

  async function loadConversations() {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (activeOrgId) params.set('orgId', activeOrgId)
    if (channel !== 'all') params.set('channel', channel)
    if (filter === 'unassigned') params.set('assignee', 'unassigned')
    else if (filter === 'mine') params.set('assignee', 'mine')
    else params.set('status', filter)
    params.set('limit', '100')

    try {
      const body = await apiGet<ConversationListResponse>(`/api/v1/communications/conversations?${params}`)
      const items = body.items ?? []
      setConversations(items)
      setSelectedId((current) => current ?? items[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversations.')
    } finally {
      setLoading(false)
    }
  }

  async function loadConversationBundle(id: string) {
    const query = orgQuery ? `?${orgQuery}` : ''
    try {
      setBundle(await apiGet<ConversationBundle>(`/api/v1/communications/conversations/${id}${query}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversation.')
    }
  }

  async function loadTemplates() {
    const query = orgQuery ? `?${orgQuery}` : ''
    try {
      const response = await apiGet<{ items: MessageTemplate[] }>(`/api/v1/communications/templates${query}`)
      setTemplates(response.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates.')
    }
  }

  async function loadChannels() {
    const query = orgQuery ? `?${orgQuery}` : ''
    try {
      setChannels(await apiGet<ChannelsResponse>(`/api/v1/communications/channels${query}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load channel readiness.')
    }
  }

  async function loadAnalytics() {
    const query = orgQuery ? `?${orgQuery}` : ''
    try {
      setAnalytics(await apiGet<Record<string, unknown>>(`/api/v1/communications/analytics${query}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analytics.')
    }
  }

  async function saveDraft({ queueApproved }: { queueApproved: boolean }) {
    if (!selectedId || !reply.trim()) return
    setFeedback(null)
    setError(null)
    try {
      await apiPost(`/api/v1/communications/conversations/${selectedId}/messages`, {
        orgId: activeOrgId || undefined,
        body: reply,
        direction: 'outbound',
        sendNow: queueApproved,
        humanApproved: queueApproved,
      })
      setReply('')
      setFeedback(queueApproved ? 'Reply queued for approved human send.' : 'Draft saved.')
      await loadConversationBundle(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save reply.')
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{mode === 'admin' ? 'Admin console' : 'Organisation console'}</p>
          <h1 className="pib-page-title mt-2">Communications command center</h1>
          <p className="pib-page-sub mt-2 max-w-3xl">
            Manage customer conversations, templates, campaigns, opt-ins, routing, channel health, and performance across WhatsApp, SMS, email, in-app, Messenger, and Instagram.
          </p>
          {mode === 'admin' && (
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
              Active organisation: {activeOrgName || 'select an organisation from the admin switcher'}
            </p>
          )}
        </div>
        <Link href={marketingHref} className="btn-pib-secondary self-start lg:self-auto">
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
          Marketing
        </Link>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Communications command summary">
        {[
          ['Workspace', workspaceLabel, activeOrgId || 'Resolving organisation', 'business_center'],
          ['Inbox control', `${FILTER_LABELS.length} queues`, 'Open, owned, pending, resolved, and snoozed work', 'inbox'],
          ['Human handoff', 'Approval gated', 'Drafts, Hermes suggestions, and outbound replies stay accountable', 'approval'],
        ].map(([label, value, sub, icon]) => (
          <div key={label} className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
                <p className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">{value}</p>
              </div>
              <span className="material-symbols-outlined text-lg text-[var(--color-pib-accent)]" aria-hidden="true">{icon}</span>
            </div>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
          </div>
        ))}
      </section>

      {!canLoad && (
        <div className="pib-card p-5">
          <p className="text-sm font-medium text-[var(--color-pib-text)]">
            {mode === 'portal' && !portalOrgReady ? 'Loading organisation context...' : 'Select an organisation to load communications.'}
          </p>
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">Communications are scoped per organisation for tenant safety.</p>
        </div>
      )}

      <PageTabs
        ariaLabel="Communications views"
        tabs={VIEW_LABELS.map((item) => ({
          label: item.label,
          value: item.id,
          icon: item.icon,
        }))}
        value={view}
        onValueChange={(value) => setView(value as ConsoleView)}
        variant="segmented"
      />

      {feedback && <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-300">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {view === 'inbox' && (
        <InboxView
          loading={loading}
          filter={filter}
          setFilter={setFilter}
          channel={channel}
          setChannel={setChannel}
          conversations={conversations}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          bundle={bundle}
          reply={reply}
          setReply={setReply}
          saveDraft={saveDraft}
        />
      )}
      {view === 'templates' && <TemplatesView templates={templates} mode={mode} selectedOrgId={activeOrgId} reload={loadTemplates} />}
      {view === 'campaigns' && <CampaignsView mode={mode} selectedOrgId={activeOrgId} />}
      {view === 'automations' && <AutomationView mode={mode} />}
      {view === 'channels' && <ChannelsView channels={channels} />}
      {view === 'analytics' && <AnalyticsView analytics={analytics} />}
    </div>
  )
}

function activeWorkspaceLabel(mode: 'admin' | 'portal', slug: string, orgId: string) {
  if (mode === 'admin') return slug || orgId || 'Admin selected workspace'
  if (slug) return `${slug} workspace`
  if (orgId) return `${orgId} workspace`
  return 'Active workspace'
}

function InboxView({
  loading,
  filter,
  setFilter,
  channel,
  setChannel,
  conversations,
  selectedId,
  setSelectedId,
  bundle,
  reply,
  setReply,
  saveDraft,
}: {
  loading: boolean
  filter: InboxFilter
  setFilter: (filter: InboxFilter) => void
  channel: CommunicationChannel | 'all'
  setChannel: (channel: CommunicationChannel | 'all') => void
  conversations: Conversation[]
  selectedId: string | null
  setSelectedId: (id: string) => void
  bundle: ConversationBundle | null
  reply: string
  setReply: (value: string) => void
  saveDraft: (options: { queueApproved: boolean }) => void
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-label uppercase tracking-widest ${
              filter === item.id
                ? 'border-[var(--color-pib-accent)] text-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)]'
            }`}
          >
            {item.label}
          </button>
        ))}
        <select
          value={channel}
          onChange={(event) => setChannel(event.target.value as CommunicationChannel | 'all')}
          className="ml-auto rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-[var(--color-pib-text)]"
        >
          <option value="all">All channels</option>
          {Object.entries(CHANNEL_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="border-b border-[var(--color-card-border)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">Conversations</p>
            <p className="text-xs text-[var(--color-pib-text-muted)]">{loading ? 'Loading...' : `${conversations.length} visible`}</p>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="px-4 py-10 text-sm text-[var(--color-pib-text-muted)]">No conversations match this view.</div>
            ) : conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedId(conversation.id)}
                className={`block w-full border-b border-[var(--color-card-border)] px-4 py-3 text-left transition-colors hover:bg-white/[0.03] ${
                  selectedId === conversation.id ? 'bg-[var(--color-pib-accent-soft)]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">
                    {conversation.contactSnapshot?.name || conversation.contactSnapshot?.email || conversation.contactSnapshot?.phone || 'Unknown contact'}
                  </p>
                  <span className="pill !text-[10px] !py-0.5 !px-2">{CHANNEL_LABELS[conversation.channel]}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--color-pib-text-muted)]">{conversation.lastMessagePreview || conversation.subject || 'No message preview yet.'}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  <span>{conversation.status}</span>
                  <span>·</span>
                  <span>{conversation.queueId || 'no queue'}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="border-b border-[var(--color-card-border)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">
              {bundle?.conversation.subject || bundle?.conversation.contactSnapshot?.name || 'Message thread'}
            </p>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Human-gated replies, with Hermes suggestions kept internal in V1.</p>
          </div>
          <div className="h-[390px] overflow-y-auto px-4 py-4">
            {!bundle ? (
              <div className="text-sm text-[var(--color-pib-text-muted)]">Select a conversation to view messages.</div>
            ) : bundle.messages.length === 0 ? (
              <div className="text-sm text-[var(--color-pib-text-muted)]">No messages have been recorded yet.</div>
            ) : (
              <div className="space-y-3">
                {bundle.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[82%] rounded-xl border px-4 py-3 ${
                      message.direction === 'outbound'
                        ? 'ml-auto border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)]'
                        : 'border-[var(--color-card-border)] bg-[var(--color-surface-container)]'
                    }`}
                  >
                    <p className="text-sm text-[var(--color-pib-text)] whitespace-pre-wrap">{message.body}</p>
                    <p className="mt-2 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      {message.direction} · {message.status}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--color-card-border)] p-4">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              rows={4}
              placeholder="Draft a human-approved reply..."
              className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-pib-accent)]"
            />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => saveDraft({ queueApproved: false })} className="btn-pib-secondary" disabled={!bundle || !reply.trim()}>
                <span className="material-symbols-outlined text-base">draft</span>
                Save draft
              </button>
              <button type="button" onClick={() => saveDraft({ queueApproved: true })} className="btn-pib-accent" disabled={!bundle || !reply.trim()}>
                <span className="material-symbols-outlined text-base">outgoing_mail</span>
                Queue approved reply
              </button>
            </div>
          </div>
        </main>

        <aside className="space-y-4">
          <Panel title="Contact profile" icon="badge">
            {bundle?.conversation ? (
              <dl className="space-y-3 text-sm">
                {profileRow('Name', bundle.conversation.contactSnapshot?.name)}
                {profileRow('Email', bundle.conversation.contactSnapshot?.email)}
                {profileRow('Phone', bundle.conversation.contactSnapshot?.phone)}
                {profileRow('Company', bundle.conversation.contactSnapshot?.company)}
                {profileRow('Tier', bundle.conversation.contactSnapshot?.tier)}
                {profileRow('Points', bundle.conversation.contactSnapshot?.pointsBalance)}
              </dl>
            ) : (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Contact context appears when a conversation is selected.</p>
            )}
          </Panel>
          <Panel title="Hermes copilot" icon="auto_awesome">
            {bundle?.hermesSuggestion ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--color-pib-text)]">{bundle.hermesSuggestion.summary}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">Owner: {bundle.hermesSuggestion.recommendedOwnerAgentId} · Priority: {bundle.hermesSuggestion.recommendedPriority}</p>
                <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-3 text-sm text-[var(--color-pib-text)]">
                  {bundle.hermesSuggestion.draftReply}
                </div>
                <p className="text-[11px] text-[var(--color-pib-text-muted)]">Internal suggestion only. Hermes cannot send customer replies directly in V1.</p>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Suggestions appear after a thread is selected.</p>
            )}
          </Panel>
        </aside>
      </div>
    </section>
  )
}

function TemplatesView({
  templates,
  mode,
  selectedOrgId,
  reload,
}: {
  templates: MessageTemplate[]
  mode: 'admin' | 'portal'
  selectedOrgId: string
  reload: () => void
}) {
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<CommunicationChannel>('whatsapp')
  const [body, setBody] = useState('Hi {{firstName}}, your update is ready.')
  const [saving, setSaving] = useState(false)

  async function createTemplate() {
    if (!name.trim() || !body.trim()) return
    setSaving(true)
    try {
      await apiPost('/api/v1/communications/templates', {
        orgId: selectedOrgId || undefined,
        name,
        channel,
        status: channel === 'whatsapp' ? 'pending_approval' : 'draft',
        category: channel === 'whatsapp' ? 'utility' : undefined,
        content: { body },
        variables: ['firstName'],
        provider: { id: channel === 'email' ? 'resend' : channel === 'in_app' ? 'in_app' : 'twilio' },
      })
      setName('')
      await reload()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Template library" icon="view_quilt">
        <div className="space-y-3">
          {templates.length === 0 ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">No templates yet. Start with WhatsApp utility, marketing, or authentication templates, then reuse the same variable model for SMS, email, in-app, and Meta DMs.</p>
          ) : templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-[var(--color-card-border)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{template.name}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{CHANNEL_LABELS[template.channel]} · {template.status}</p>
                </div>
                <span className="pill !text-[10px] !py-0.5 !px-2">{template.variables.length} vars</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-[var(--color-pib-text-muted)]">{template.content.body}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Create template" icon="add_box">
        <div className="space-y-3">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" className={FIELD_CLASS} />
          <select value={channel} onChange={(event) => setChannel(event.target.value as CommunicationChannel)} className={FIELD_CLASS}>
            {Object.entries(CHANNEL_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} className={FIELD_CLASS} />
          <button type="button" onClick={createTemplate} disabled={saving || !name.trim()} className="btn-pib-accent w-full justify-center">
            <span className="material-symbols-outlined text-base">save</span>
            {mode === 'admin' ? 'Create template' : 'Save draft'}
          </button>
        </div>
      </Panel>
    </div>
  )
}

function CampaignsView({ mode, selectedOrgId }: { mode: 'admin' | 'portal'; selectedOrgId: string }) {
  const steps = [
    'Pick CRM segment, contact list, or tags',
    'Choose a channel template and map variables',
    'Preview by member/contact profile',
    'Send now, schedule, duplicate, or cancel',
    'Route replies to queue and track delivery/read/reply/cost',
  ]
  return (
    <Panel title="Campaign builder" icon="campaign">
      <div className="grid gap-3 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-3">
            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Step {index + 1}</p>
            <p className="mt-2 text-sm text-[var(--color-pib-text)]">{step}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-[var(--color-card-border)] p-4">
        <p className="text-sm font-medium text-[var(--color-pib-text)]">V1 send controls</p>
        <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
          Campaigns are modelled for WhatsApp-first execution with SMS/email/in-app expansion. Messenger and Instagram remain disabled until provider readiness is confirmed.
        </p>
        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Scope: {mode === 'admin' ? selectedOrgId || 'admin selected org' : 'portal organisation'}</p>
      </div>
    </Panel>
  )
}

function AutomationView({ mode }: { mode: 'admin' | 'portal' }) {
  const rules = [
    ['STOP/START/HELP', 'Compliance and preference handling'],
    ['Balance keyword', 'Reply from CRM/member profile context'],
    ['After-hours', 'Send business-hours auto-response'],
    ['Stale unassigned', 'Route to queue before SLA slips'],
    ['Campaign replies', 'Send replies to campaign team'],
    ['Urgent keywords', 'Escalate and prioritise'],
    ['Hermes suggestions', 'Summaries, labels, owners, draft replies'],
  ]
  return (
    <Panel title="Automation rules" icon="account_tree">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rules.map(([title, desc]) => (
          <div key={title} className="rounded-lg border border-[var(--color-card-border)] p-4">
            <p className="text-sm font-medium text-[var(--color-pib-text)]">{title}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{desc}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-[var(--color-pib-text-muted)]">
        {mode === 'admin' ? 'Admins can supervise and tune rules across organisations.' : 'Rules apply inside your organisation workspace.'}
      </p>
    </Panel>
  )
}

function ChannelsView({ channels }: { channels: ChannelsResponse | null }) {
  return (
    <Panel title="Channel readiness" icon="settings_input_antenna">
      <div className="grid gap-3 lg:grid-cols-2">
        {(channels?.providers ?? []).map((provider) => (
          <div key={provider.id} className="rounded-lg border border-[var(--color-card-border)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-pib-text)]">{provider.name}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">{provider.supports.map((item) => CHANNEL_LABELS[item]).join(', ')}</p>
              </div>
              <span className={`pill !text-[10px] !py-0.5 !px-2 ${provider.readiness.healthy ? '' : '!border-yellow-500/30 !text-yellow-300'}`}>
                {provider.readiness.healthy ? 'Ready' : 'Needs setup'}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {provider.readiness.checks.map((check) => (
                <div key={check.id} className="flex gap-2 text-xs">
                  <span className={`mt-1 h-2 w-2 rounded-full ${check.status === 'pass' ? 'bg-green-400' : check.status === 'warn' ? 'bg-yellow-400' : 'bg-red-400'}`} />
                  <div>
                    <p className="text-[var(--color-pib-text)]">{check.label}</p>
                    {check.detail && <p className="text-[var(--color-pib-text-muted)]">{check.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!channels && <p className="text-sm text-[var(--color-pib-text-muted)]">Open this tab to load provider readiness, queues, and routing rules.</p>}
      </div>
    </Panel>
  )
}

function AnalyticsView({ analytics }: { analytics: Record<string, unknown> | null }) {
  const campaigns = Array.isArray(analytics?.campaigns) ? analytics.campaigns as Array<Record<string, unknown>> : []
  const optOuts = analytics?.optOuts as { total?: number } | undefined
  return (
    <Panel title="Performance" icon="query_stats">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Campaigns" value={campaigns.length} />
        <Metric label="Opt-outs" value={optOuts?.total ?? 0} />
        <Metric label="Channels" value={analytics ? Object.keys((analytics.channelVolume as Record<string, unknown>) ?? {}).length : 0} />
        <Metric label="Queues" value={analytics ? Object.keys(((analytics.workload as Record<string, unknown>)?.byQueue as Record<string, unknown>) ?? {}).length : 0} />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-card-border)]">
        <div className="grid grid-cols-6 gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-4 py-2 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
          <span className="col-span-2">Campaign</span>
          <span>Sent</span>
          <span>Read</span>
          <span>Replies</span>
          <span>Cost</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-4 py-8 text-sm text-[var(--color-pib-text-muted)]">No campaign performance has been recorded yet.</div>
        ) : campaigns.map((campaign) => (
          <div key={String(campaign.id)} className="grid grid-cols-6 gap-3 border-b border-[var(--color-card-border)] px-4 py-3 text-sm last:border-b-0">
            <span className="col-span-2 text-[var(--color-pib-text)]">{String(campaign.name)}</span>
            <span>{String(campaign.sent ?? 0)}</span>
            <span>{formatPercent(campaign.readRate)}</span>
            <span>{formatPercent(campaign.replyRate)}</span>
            <span>${Number(campaign.costUsd ?? 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function Panel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-card-border)] px-4 py-3">
        <span className="material-symbols-outlined text-lg text-[var(--color-pib-accent)]">{icon}</span>
        <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-4">
      <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-display text-[var(--color-pib-text)]">{value}</p>
    </div>
  )
}

function profileRow(label: string, value: unknown) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div key={label} className="flex items-start justify-between gap-3">
      <dt className="text-[var(--color-pib-text-muted)]">{label}</dt>
      <dd className="text-right font-medium text-[var(--color-pib-text)]">{String(value)}</dd>
    </div>
  )
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({})) as ApiEnvelope<T>
  if (!res.ok || body.success === false) throw new Error(body.error || 'Request failed')
  return body.data as T
}

async function apiPost<T = unknown>(url: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({})) as ApiEnvelope<T>
  if (!res.ok || body.success === false) throw new Error(body.error || 'Request failed')
  return body.data as T
}

function formatPercent(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isFinite(number)) return '0%'
  return `${Math.round(number * 100)}%`
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import UnifiedChat from '@/components/chat/UnifiedChat'
import { ChatMessageContent } from '@/components/chat/MessageBubble'
import type { Conversation } from '@/components/chat/ConversationListItem'
import {
  normalizeWorkspacePanel,
  WORKSPACE_PANEL_EVENT,
  type WorkspacePanelSpec,
} from '@/lib/hermes/workspace-panels'
import { ModuleShell } from '@/components/ui/ModuleShell'
import { Icon } from '@/components/studio'
import { DeepSeekUsageChip } from '@/components/messages/hermes/DeepSeekUsageChip'
import { MessagesExperienceSwitch } from '@/components/messages/bot-mode/MessagesExperienceSwitch'
import '@/components/messages/atmosphere/messages-quiet.css'
import { conversationFolderAccentSeed, folderAccentStyle } from '@/lib/messages/folder-accent'
import {
  applyConversationLifecycle,
  clearTabActivity,
  messagesIndicateInFlightRun,
  shouldUseBackgroundRunPolling,
  type ConversationLifecycleEvent,
  type TabActivityPhase,
} from '@/lib/messages/tab-activity'
import {
  applyExperienceModeToSearch,
  BOT_MODE_COPY,
  MESSAGES_EXPERIENCE_MODE_STORAGE_FIELD,
  resolveMessagesExperienceMode,
  type MessagesExperienceMode,
} from '@/lib/messages/experience-mode'
import type { HermesMessagesShellProps, MessagesSurface } from './types'

const SURFACE_META: Record<MessagesSurface, { title: string; description: string }> = {
  admin: {
    title: 'Messages',
    description: 'Hermes-backed conversations with agents, runtime controls and team context.',
  },
  portal: {
    title: 'Messages',
    description: 'Dense Hermes-style workspace for conversations with Pip and the Partners team.',
  },
}

function readStoredExperienceMode(storageKey: string, initialExperienceMode?: MessagesExperienceMode): MessagesExperienceMode {
  if (typeof window === 'undefined') return initialExperienceMode ?? 'messages'
  const searchParam = new URLSearchParams(window.location.search).get('mode')
  let stored: unknown
  try {
    stored = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')?.[MESSAGES_EXPERIENCE_MODE_STORAGE_FIELD]
  } catch {
    stored = undefined
  }
  return resolveMessagesExperienceMode({
    searchParam: initialExperienceMode ?? searchParam,
    stored,
  })
}

function syncExperienceModeToUrl(mode: MessagesExperienceMode) {
  if (typeof window === 'undefined') return
  const next = `${window.location.pathname}${applyExperienceModeToSearch(window.location.search, mode)}${window.location.hash}`
  window.history.replaceState(window.history.state, '', next)
}

type ConversationTab = { id: string; kind: 'conversation'; conversationId: string; title: string; accentSeed?: string | null }
type PanelTab = { id: string; kind: 'panel'; panel: WorkspacePanelSpec; title: string }
type WorkspaceTab = ConversationTab | PanelTab
type WorkspacePane = { id: string; tabs: WorkspaceTab[]; activeTabId: string | null }
type ParkedConversationTab = ConversationTab & { parkedFromPaneId: string }
type WorkspaceDirection = 'row' | 'column'
type TabTransfer = { id: string; direction: 'parking' | 'restoring' }

const TAB_TRANSFER_DURATION_MS = 220

function conversationTab(conversationId: string, title = 'Session', accentSeed: string | null = null): ConversationTab {
  return { id: `conversation:${conversationId}`, kind: 'conversation', conversationId, title, accentSeed }
}

function initialPanes(initialConvId?: string): WorkspacePane[] {
  const tabs = initialConvId ? [conversationTab(initialConvId)] : []
  return [{ id: 'primary', tabs, activeTabId: tabs[0]?.id ?? null }]
}

function safeStoredPanes(value: unknown, initialConvId?: string): WorkspacePane[] {
  if (!Array.isArray(value)) return initialPanes(initialConvId)
  const panes = value.slice(0, 2).flatMap((rawPane, paneIndex): WorkspacePane[] => {
    if (!rawPane || typeof rawPane !== 'object') return []
    const pane = rawPane as Record<string, unknown>
    const tabs = (Array.isArray(pane.tabs) ? pane.tabs : []).slice(0, 12).flatMap((rawTab): WorkspaceTab[] => {
      if (!rawTab || typeof rawTab !== 'object') return []
      const tab = rawTab as Record<string, unknown>
      if (tab.kind !== 'conversation' || typeof tab.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tab.conversationId)) return []
      return [conversationTab(tab.conversationId, typeof tab.title === 'string' ? tab.title.slice(0, 120) : 'Session')]
    })
    const activeTabId = typeof pane.activeTabId === 'string' && tabs.some((tab) => tab.id === pane.activeTabId)
      ? pane.activeTabId
      : tabs[0]?.id ?? null
    return [{ id: paneIndex === 0 ? 'primary' : 'secondary', tabs, activeTabId }]
  })
  return panes.length ? panes : initialPanes(initialConvId)
}

function safeStoredParkedTabs(value: unknown): ParkedConversationTab[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((rawTab): ParkedConversationTab[] => {
    if (!rawTab || typeof rawTab !== 'object') return []
    const tab = rawTab as Record<string, unknown>
    if (tab.kind !== 'conversation' || typeof tab.conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tab.conversationId)) return []
    const parkedFromPaneId = tab.parkedFromPaneId === 'secondary' ? 'secondary' : 'primary'
    return [{
      ...conversationTab(tab.conversationId, typeof tab.title === 'string' ? tab.title.slice(0, 120) : 'Session'),
      parkedFromPaneId,
    }]
  })
}

function StatusPill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'accent' | 'muted' }) {
  const toneClass = tone === 'accent'
    ? 'border-primary/25 bg-primary/10 text-primary'
    : tone === 'muted'
      ? 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] text-[var(--color-pib-text-muted)]'
      : 'border-[var(--sc-ink-soft)]/25 bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] text-[var(--sc-ink-soft)]'
  return <span className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] ${toneClass}`}>{children}</span>
}

function GeneratedWorkspacePanel({ panel }: { panel: WorkspacePanelSpec }) {
  return (
    <section data-testid={`generated-workspace-panel-${panel.id}`} className="h-full min-h-0 overflow-y-auto p-4 sm:p-5">
      <div className="mx-auto max-w-5xl">
        <p className="pib-label text-primary">{panel.eyebrow ?? 'Generated workspace UI'}</p>
        <h2 className="mt-1 text-xl font-medium text-[var(--color-pib-text)]">{panel.title}</h2>
        {panel.body && <div className="mt-3 text-sm leading-relaxed text-[var(--color-pib-text-muted)]"><ChatMessageContent content={panel.body} /></div>}
        {panel.metrics.length > 0 && (
          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {panel.metrics.map((metric) => (
              <article key={metric.label} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] p-3">
                <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{metric.label}</p>
                <p className="mt-1 text-lg font-medium text-[var(--color-pib-text)]">{metric.value}</p>
                {metric.detail && <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{metric.detail}</p>}
              </article>
            ))}
          </div>
        )}
        {panel.sections.length > 0 && (
          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            {panel.sections.map((section, index) => (
              <article key={`${section.heading ?? 'section'}-${index}`} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] p-4">
                {section.heading && <h3 className="text-sm font-medium text-[var(--color-pib-text)]">{section.heading}</h3>}
                {section.body && <div className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]"><ChatMessageContent content={section.body} /></div>}
                {section.items && section.items.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--color-pib-text-muted)]">{section.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul>}
              </article>
            ))}
          </div>
        )}
        {panel.rows.length > 0 && (
          <div className="mt-5 overflow-x-auto rounded-lg border border-[var(--color-card-border)]">
            <table className="min-w-full border-collapse text-left text-xs">
              {panel.columns.length > 0 && <thead className="bg-[var(--color-pib-surface-muted)]"><tr>{panel.columns.map((column) => <th key={column} className="border-b border-[var(--color-card-border)] px-3 py-2 font-medium">{column}</th>)}</tr></thead>}
              <tbody>{panel.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-[var(--color-card-border)] last:border-0">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-[var(--color-pib-text-muted)]">{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export function HermesMessagesShell(props: HermesMessagesShellProps) {
  const { surface, orgId, currentUserUid, currentUserDisplayName, orgName, userRole, initialConvId, initialExperienceMode, capabilities, agentRoomsEnabled = false } = props
  const copy = SURFACE_META[surface]
  const runtimeMode = capabilities.allowAgentParticipants ? 'Agents enabled' : 'Human-only'
  const storageKey = `pib.messages.workspace.v1:${orgId}:${currentUserUid}`
  const [panes, setPanes] = useState<WorkspacePane[]>(() => {
    if (typeof window === 'undefined') return initialPanes(initialConvId)
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as { panes?: unknown } | null
      return safeStoredPanes(stored?.panes, initialConvId)
    } catch { return initialPanes(initialConvId) }
  })
  const [parkedTabs, setParkedTabs] = useState<ParkedConversationTab[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as { parkedTabs?: unknown } | null
      return safeStoredParkedTabs(stored?.parkedTabs)
    } catch { return [] }
  })
  const [direction, setDirection] = useState<WorkspaceDirection>(() => {
    if (typeof window === 'undefined') return 'row'
    try { return JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')?.direction === 'column' ? 'column' : 'row' } catch { return 'row' }
  })
  const [splitPercent, setSplitPercent] = useState(() => {
    if (typeof window === 'undefined') return 50
    try {
      const value = Number(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')?.splitPercent)
      return Number.isFinite(value) ? Math.min(72, Math.max(28, value)) : 50
    } catch { return 50 }
  })
  const [conversationRailMode, setConversationRailMode] = useState<'expanded' | 'collapsed'>(() => {
    if (typeof window === 'undefined') return 'expanded'
    try { return JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')?.conversationRailMode === 'collapsed' ? 'collapsed' : 'expanded' } catch { return 'expanded' }
  })
  const [experienceMode, setExperienceMode] = useState<MessagesExperienceMode>(() => readStoredExperienceMode(storageKey, initialExperienceMode))
  const [canvasForcesCollapsedRail, setCanvasForcesCollapsedRail] = useState(false)
  const [focusedPaneId, setFocusedPaneId] = useState('primary')
  const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({})
  const [conversationAccentSeeds, setConversationAccentSeeds] = useState<Record<string, string>>({})
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameTabValue, setRenameTabValue] = useState('')
  /** Background-tab attention: pulse while running, underline until opened. */
  const [tabActivityByConversationId, setTabActivityByConversationId] = useState<Record<string, TabActivityPhase>>({})
  const [realtimeGatewayClientIds, setRealtimeGatewayClientIds] = useState<Set<string>>(() => new Set())
  const [tabTransfer, setTabTransfer] = useState<TabTransfer | null>(null)
  const [resumedTabId, setResumedTabId] = useState<string | null>(null)
  const renameTabCancelledRef = useRef(false)
  const dragRef = useRef<{ origin: number; percent: number; size: number } | null>(null)

  useEffect(() => {
    const persistable = panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.filter((tab): tab is ConversationTab => tab.kind === 'conversation'),
    }))
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
        panes: persistable,
        parkedTabs,
        direction,
        splitPercent,
        conversationRailMode,
        [MESSAGES_EXPERIENCE_MODE_STORAGE_FIELD]: experienceMode,
      }))
    } catch (storageError) {
      // Private browsing or storage policy must not break Messages.
      void storageError
    }
  }, [conversationRailMode, direction, experienceMode, panes, parkedTabs, splitPercent, storageKey])

  const focusedConversationIds = useMemo(() => {
    const ids = new Set<string>()
    for (const pane of panes) {
      const active = pane.tabs.find((tab) => tab.id === pane.activeTabId)
      if (active?.kind === 'conversation') ids.add(active.conversationId)
    }
    return ids
  }, [panes])
  // Keep focus in a ref so UnifiedChat's stable lifecycle callback always sees
  // the latest active tabs (mock/first-render handlers must not freeze focus).
  const focusedConversationIdsRef = useRef(focusedConversationIds)
  useEffect(() => {
    focusedConversationIdsRef.current = focusedConversationIds
  }, [focusedConversationIds])

  const handleConversationLifecycle = useCallback((event: ConversationLifecycleEvent) => {
    setTabActivityByConversationId((current) => applyConversationLifecycle(
      current,
      event,
      focusedConversationIdsRef.current,
    ))
  }, [])

  const checkBackgroundConversationRun = useCallback(async (conversationId: string) => {
    if (focusedConversationIdsRef.current.has(conversationId)) return
    try {
      const response = await fetch(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?limit=20`,
        { cache: 'no-store' },
      )
      if (!response.ok) return
      const body = await response.json().catch(() => null) as {
        data?: Array<{ role?: string; runId?: string | null; status?: string | null }>
          | { messages?: Array<{ role?: string; runId?: string | null; status?: string | null }> }
        messages?: Array<{ role?: string; runId?: string | null; status?: string | null }>
      } | null
      const raw = body?.data
      const messages = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.messages) ? raw.messages : (body?.messages ?? []))
      if (messagesIndicateInFlightRun(messages)) return
      setTabActivityByConversationId((current) => applyConversationLifecycle(
        current,
        { conversationId, phase: 'completed' },
        focusedConversationIdsRef.current,
      ))
    } catch {
      // Network blips must not clear activity; the gateway or fallback retries.
    }
  }, [])

  const handleRealtimeGatewayConnectionChange = useCallback((clientId: string, ready: boolean) => {
    setRealtimeGatewayClientIds((current) => {
      const next = new Set(current)
      if (ready) next.add(clientId)
      else next.delete(clientId)
      return next
    })
  }, [])

  const handleConversationRealtimeInvalidation = useCallback((event: { conversationId: string }) => {
    if (tabActivityByConversationId[event.conversationId] === 'running') {
      void checkBackgroundConversationRun(event.conversationId)
    }
  }, [checkBackgroundConversationRun, tabActivityByConversationId])

  const openConversation = useCallback((paneId: string, conversationId: string | null) => {
    if (!conversationId) return
    setFocusedPaneId(paneId)
    setTabActivityByConversationId((current) => clearTabActivity(current, conversationId))
    // Choosing a parked conversation from the Sessions rail is a resume action,
    // not a second copy of the same workspace tab.
    setParkedTabs((current) => current.filter((tab) => tab.conversationId !== conversationId))
    setPanes((current) => current.map((pane) => {
      if (pane.id !== paneId) return pane
      const tab = conversationTab(
        conversationId,
        conversationTitles[conversationId] ?? 'Session',
        conversationAccentSeeds[conversationId] ?? null,
      )
      const tabs = pane.tabs.some((item) => item.id === tab.id)
        ? pane.tabs.map((item) => item.id === tab.id
          ? { ...item, title: tab.title, ...(item.kind === 'conversation' ? { accentSeed: tab.accentSeed } : {}) }
          : item)
        : [...pane.tabs, tab].slice(-12)
      return { ...pane, tabs, activeTabId: tab.id }
    }))
  }, [conversationAccentSeeds, conversationTitles])

  const handleConversationCatalogue = useCallback((conversations: Conversation[]) => {
    const titles = Object.fromEntries(conversations.map((conversation) => [conversation.id, conversation.title || 'Untitled session']))
    const accents = Object.fromEntries(conversations.flatMap((conversation) => {
      const seed = conversationFolderAccentSeed(conversation)
      return seed ? [[conversation.id, seed]] : []
    }))
    setConversationTitles(titles)
    setConversationAccentSeeds(accents)
    setParkedTabs((current) => current.map((tab) => {
      const title = titles[tab.conversationId]
      const accentSeed = accents[tab.conversationId] ?? null
      if (!title && accentSeed === (tab.accentSeed ?? null)) return tab
      return { ...tab, ...(title ? { title } : {}), accentSeed }
    }))
    setPanes((current) => current.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => {
        if (tab.kind !== 'conversation') return tab
        const title = titles[tab.conversationId]
        const accentSeed = accents[tab.conversationId] ?? null
        if (!title && accentSeed === (tab.accentSeed ?? null)) return tab
        return {
          ...tab,
          ...(title ? { title } : {}),
          accentSeed,
        }
      }),
    })))
  }, [])

  const splitActiveTab = useCallback(() => {
    setPanes((current) => {
      if (current.length > 1) return current
      const source = current.find((pane) => pane.id === focusedPaneId) ?? current[0]
      const active = source?.tabs.find((tab) => tab.id === source.activeTabId)
      return [...current, { id: 'secondary', tabs: active ? [active] : [], activeTabId: active?.id ?? null }]
    })
    setFocusedPaneId('secondary')
  }, [focusedPaneId])

  useEffect(() => {
    const listener = (event: Event) => {
      const panel = normalizeWorkspacePanel((event as CustomEvent).detail)
      if (!panel) return
      const tab: PanelTab = { id: `panel:${panel.id}`, kind: 'panel', panel, title: panel.title }
      setPanes((current) => {
        const withSecondary = current.length > 1 ? current : [...current, { id: 'secondary', tabs: [], activeTabId: null }]
        return withSecondary.map((pane) => pane.id !== 'secondary'
          ? pane
          : { ...pane, tabs: pane.tabs.some((item) => item.id === tab.id) ? pane.tabs.map((item) => item.id === tab.id ? tab : item) : [...pane.tabs, tab].slice(-12), activeTabId: tab.id })
      })
      setFocusedPaneId('secondary')
    }
    window.addEventListener(WORKSPACE_PANEL_EVENT, listener)
    return () => window.removeEventListener(WORKSPACE_PANEL_EVENT, listener)
  }, [])

  const closeTab = (paneId: string, tabId: string) => {
    setPanes((current) => {
      const next = current.map((pane) => {
        if (pane.id !== paneId) return pane
        const index = pane.tabs.findIndex((tab) => tab.id === tabId)
        const tabs = pane.tabs.filter((tab) => tab.id !== tabId)
        const activeTabId = pane.activeTabId === tabId ? tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? null : pane.activeTabId
        return { ...pane, tabs, activeTabId }
      })
      return next.length > 1 && next[1].tabs.length === 0 ? [next[0]] : next
    })
    if (paneId === 'secondary') setFocusedPaneId('primary')
    if (renamingTabId === tabId) setRenamingTabId(null)
  }

  const parkConversationTab = useCallback((paneId: string, tab: ConversationTab) => {
    if (tabTransfer) return
    setTabTransfer({ id: tab.id, direction: 'parking' })
    window.setTimeout(() => {
      setTabActivityByConversationId((current) => clearTabActivity(current, tab.conversationId))
      setPanes((current) => {
        const next = current.map((pane) => {
          if (pane.id !== paneId) return pane
          const index = pane.tabs.findIndex((item) => item.id === tab.id)
          const tabs = pane.tabs.filter((item) => item.id !== tab.id)
          const activeTabId = pane.activeTabId === tab.id
            ? tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? null
            : pane.activeTabId
          return { ...pane, tabs, activeTabId }
        })
        return next.length > 1 && next[1].tabs.length === 0 ? [next[0]] : next
      })
      setParkedTabs((current) => {
        const parked = { ...tab, parkedFromPaneId: paneId }
        return current.some((item) => item.id === tab.id)
          ? current.map((item) => item.id === tab.id ? parked : item)
          : [...current, parked].slice(-12)
      })
      if (paneId === 'secondary') setFocusedPaneId('primary')
      if (renamingTabId === tab.id) setRenamingTabId(null)
      setTabTransfer(null)
    }, TAB_TRANSFER_DURATION_MS)
  }, [renamingTabId, tabTransfer])

  const restoreParkedTab = useCallback((tab: ParkedConversationTab) => {
    if (tabTransfer) return
    setTabTransfer({ id: tab.id, direction: 'restoring' })
    window.setTimeout(() => {
    const targetPaneId = focusedPaneId
    setPanes((current) => {
      const targetExists = current.some((pane) => pane.id === targetPaneId)
      const destinationPaneId = targetExists ? targetPaneId : tab.parkedFromPaneId
      return current.map((pane) => {
        if (pane.id !== destinationPaneId) return pane
        const tabs = pane.tabs.some((item) => item.id === tab.id)
          ? pane.tabs.map((item) => item.id === tab.id ? tab : item)
          : [...pane.tabs, tab].slice(-12)
        return { ...pane, tabs, activeTabId: tab.id }
      })
    })
    setParkedTabs((current) => current.filter((item) => item.id !== tab.id))
    setTabActivityByConversationId((current) => clearTabActivity(current, tab.conversationId))
    setResumedTabId(tab.id)
    setTabTransfer(null)
    window.setTimeout(() => setResumedTabId((current) => current === tab.id ? null : current), TAB_TRANSFER_DURATION_MS)
    }, TAB_TRANSFER_DURATION_MS)
  }, [focusedPaneId, tabTransfer])

  const beginRenameTab = (tab: WorkspaceTab) => {
    if (tab.kind !== 'conversation') return
    renameTabCancelledRef.current = false
    setRenamingTabId(tab.id)
    setRenameTabValue(tab.title)
  }

  const commitRenameTab = useCallback(async (tab: ConversationTab, title: string) => {
    const trimmed = title.trim().slice(0, 120)
    setRenamingTabId(null)
    if (!trimmed || trimmed === tab.title) return
    setConversationTitles((current) => ({ ...current, [tab.conversationId]: trimmed }))
    setPanes((current) => current.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((item) => item.kind === 'conversation' && item.conversationId === tab.conversationId
        ? { ...item, title: trimmed }
        : item),
    })))
    await fetch(`/api/v1/conversations/${tab.conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {})
  }, [])

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    dragRef.current = { origin: direction === 'row' ? event.clientX : event.clientY, percent: splitPercent, size: direction === 'row' ? rect.width : rect.height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const continueResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    const cursor = direction === 'row' ? event.clientX : event.clientY
    setSplitPercent(Math.min(72, Math.max(28, dragRef.current.percent + ((cursor - dragRef.current.origin) / dragRef.current.size) * 100)))
  }
  const finishResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const chatProps = useMemo(() => ({
    orgId,
    currentUserUid,
    currentUserDisplayName,
    userRole,
    orgName,
    includeAllScopes: true,
    allowDeleteConversations: surface === 'admin',
    // Anyone in the chat can stop an in-flight agent run.
    allowStopRuns: true,
    allowManageConversationAccess: surface === 'admin',
    allowAgentParticipants: capabilities.allowAgentParticipants,
    allowStartConversations: capabilities.allowStartConversations,
    allowSendMessages: capabilities.allowSendMessages,
    allowArchiveConversations: capabilities.allowArchiveConversations,
    layoutVariant: 'hermes' as const,
    showAgentWorkbench: true,
    computersHref: '/portal/settings/linked-computers',
    agentRoomsEnabled,
  }), [agentRoomsEnabled, capabilities, currentUserDisplayName, currentUserUid, orgId, orgName, surface, userRole])

  const handleExperienceModeChange = useCallback((mode: MessagesExperienceMode) => {
    setExperienceMode(mode)
    syncExperienceModeToUrl(mode)
  }, [])

  const focusedPane = panes.find((pane) => pane.id === focusedPaneId) ?? panes[0]

  // The GCP gateway invalidates a running background tab when it changes. Keep
  // a deliberately slower polling path only while every gateway connection is
  // unavailable, so a gateway outage cannot leave a tab stuck as running.
  useEffect(() => {
    if (!shouldUseBackgroundRunPolling(realtimeGatewayClientIds.size > 0)) return undefined
    const runningIds = Object.entries(tabActivityByConversationId)
      .filter(([, phase]) => phase === 'running')
      .map(([conversationId]) => conversationId)
      .filter((conversationId) => !focusedConversationIds.has(conversationId))
    if (runningIds.length === 0) return undefined

    let cancelled = false
    const check = async () => {
      await Promise.all(runningIds.map(async (conversationId) => {
        if (!cancelled) await checkBackgroundConversationRun(conversationId)
      }))
    }

    void check()
    const timer = window.setInterval(() => { void check() }, 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [checkBackgroundConversationRun, realtimeGatewayClientIds, tabActivityByConversationId])

  return (
    <ModuleShell
      tier={0}
      accent="amber"
      shellTestId="hermes-messages-shell"
      data-messages-experience="quiet-2026"
      data-experience-mode={experienceMode}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-none border-0 bg-[var(--color-pib-bg)] shadow-none ${
        experienceMode === 'bot'
          ? 'h-full min-h-0'
          : 'h-[calc(100dvh-72px)] lg:min-h-[640px]'
      }`}
    >
      <header data-testid="hermes-messages-shell-topbar" className={`hidden h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2.5 md:flex ${experienceMode === 'bot' ? 'pl-12' : ''}`}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon name={experienceMode === 'bot' ? 'smart_toy' : 'forum'} className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[15px] text-primary" />
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-medium leading-tight text-[var(--color-pib-text)]">{experienceMode === 'bot' ? BOT_MODE_COPY.title : copy.title}</h1>
            {experienceMode !== 'bot' && orgName && <span className="hidden truncate text-xs text-[var(--color-pib-text-muted)] sm:inline">· {orgName}</span>}
            {experienceMode !== 'bot' && parkedTabs.length > 0 && (
              <span className="hidden rounded-md border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)] sm:inline">
                Parked {parkedTabs.length}
              </span>
            )}
          </div>
          {experienceMode !== 'bot' && <DeepSeekUsageChip orgId={orgId} />}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <MessagesExperienceSwitch value={experienceMode} onChange={handleExperienceModeChange} />
          {experienceMode !== 'bot' && (
            <>
              <div className="hidden items-center gap-1.5 xl:flex">
                <StatusPill tone="muted"><Icon name="hub" className="text-[13px]" />{runtimeMode}</StatusPill>
              </div>
              <button type="button" aria-label={conversationRailMode === 'expanded' ? 'Collapse sessions' : 'Expand sessions'} onClick={() => setConversationRailMode((value) => value === 'expanded' ? 'collapsed' : 'expanded')} className="hidden h-7 w-7 place-items-center rounded-md border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] xl:grid"><Icon name={conversationRailMode === 'expanded' ? 'left_panel_close' : 'left_panel_open'} className="text-[16px]" /></button>
              <button type="button" aria-label={direction === 'row' ? 'Stack panes vertically' : 'Place panes side by side'} onClick={() => setDirection((value) => value === 'row' ? 'column' : 'row')} disabled={panes.length < 2} className="grid h-11 w-11 place-items-center rounded-md border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] disabled:opacity-35 xl:h-7 xl:w-7"><Icon name={direction === 'row' ? 'horizontal_split' : 'vertical_split'} className="text-[16px]" /></button>
              <button type="button" aria-label="Open active session in split pane" onClick={splitActiveTab} disabled={panes.length > 1} className="grid h-11 w-11 place-items-center rounded-md border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] disabled:opacity-35 xl:h-7 xl:w-7"><Icon name="splitscreen" className="text-[16px]" /></button>
            </>
          )}
          {experienceMode === 'bot' && (
            <button type="button" aria-label={conversationRailMode === 'expanded' ? 'Collapse sessions' : 'Expand sessions'} onClick={() => setConversationRailMode((value) => value === 'expanded' ? 'collapsed' : 'expanded')} className="hidden h-7 w-7 place-items-center rounded-md border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] xl:grid"><Icon name={conversationRailMode === 'expanded' ? 'left_panel_close' : 'left_panel_open'} className="text-[16px]" /></button>
          )}
        </div>
      </header>
      <div className="sr-only" data-testid="hermes-messages-shell-description">{experienceMode === 'bot' ? BOT_MODE_COPY.description : copy.description}</div>
      <section data-testid="hermes-messages-shell-body" className="flex min-h-0 min-w-0 flex-1 overflow-hidden p-1">
        <div className={`flex h-full min-h-0 min-w-0 flex-1 ${direction === 'row' ? 'flex-row' : 'flex-col'}`}>
          {panes.map((pane, paneIndex) => {
            const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null
            // Parked tabs stay in the primary tab strip so they remain one click
            // away without taking a column from the workspace.
            const parkedTabsForPane = pane.id === 'primary' ? parkedTabs : []
            const paneBasis = panes.length === 1 ? 100 : paneIndex === 0 ? splitPercent : 100 - splitPercent
            // The desktop resizer contributes a net 4px to the flex line
            // (8px size with -2px margins on both sides). Split that cost
            // evenly so both pane bases plus the resizer fit the container.
            const workspacePaneBasis = panes.length === 1 ? `${paneBasis}%` : `calc(${paneBasis}% - 2px)`
            const style = {
              '--workspace-pane-basis': workspacePaneBasis,
              order: paneIndex * 2,
            } as CSSProperties
            const alternatePaneId = pane.id === 'primary' ? 'secondary' : 'primary'
            return (
              <div key={pane.id} data-testid={`messages-workspace-pane-${pane.id}`} style={style} onPointerDown={() => setFocusedPaneId(pane.id)} className={`flex min-h-0 min-w-0 flex-1 basis-full flex-col overflow-hidden rounded-none border xl:flex-none xl:basis-[var(--workspace-pane-basis)] ${focusedPaneId === pane.id ? 'border-primary/35' : 'border-[var(--color-card-border)]'} bg-[var(--color-pib-bg)] ${panes.length > 1 && pane.id !== focusedPaneId ? 'max-xl:hidden' : ''}`}>
                <div className={`${experienceMode === 'bot' ? 'hidden' : 'flex'} min-h-11 min-w-0 shrink-0 items-center border-b border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-1 xl:h-8 xl:min-h-0`}>
                  <div role="tablist" aria-label={`${pane.id} pane tabs`} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                    {pane.tabs.map((tab) => {
                      const accentSeed = tab.kind === 'conversation' ? tab.accentSeed : null
                      const isActiveTab = tab.id === pane.activeTabId
                      const activity = tab.kind === 'conversation' && !isActiveTab
                        ? tabActivityByConversationId[tab.conversationId]
                        : undefined
                      const activityClass = activity === 'running'
                        ? 'mx-tab-running'
                        : activity === 'unread'
                          ? 'mx-tab-unread'
                          : ''
                      const transferClass = tabTransfer?.id === tab.id && tabTransfer.direction === 'parking'
                        ? 'mx-workspace-tab-parking'
                        : resumedTabId === tab.id
                          ? 'mx-workspace-tab-return'
                          : ''
                      return (
                      <div
                        key={tab.id}
                        role="presentation"
                        data-testid={tab.kind === 'conversation' ? `workspace-tab-${tab.conversationId}` : `workspace-tab-panel-${tab.panel.id}`}
                        data-folder-accent={accentSeed || undefined}
                        data-tab-activity={activity || undefined}
                        style={folderAccentStyle(accentSeed)}
                        className={`group/tab relative flex min-h-11 min-w-[92px] max-w-[220px] items-center overflow-hidden rounded-md border px-1.5 xl:h-6 xl:min-h-0 ${accentSeed ? 'mx-folder-accent pl-2' : ''} ${isActiveTab ? 'border-[var(--color-pib-line)] bg-[var(--color-row-hover)]' : 'border-transparent text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)]'} ${activityClass} ${transferClass}`}
                      >
                        {renamingTabId === tab.id && tab.kind === 'conversation' ? (
                          <input
                            autoFocus
                            data-testid={`workspace-tab-rename-${tab.conversationId}`}
                            aria-label="Rename conversation"
                            value={renameTabValue}
                            onChange={(event) => setRenameTabValue(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void commitRenameTab(tab, renameTabValue)
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                renameTabCancelledRef.current = true
                                setRenamingTabId(null)
                              }
                            }}
                            onBlur={() => {
                              if (!renameTabCancelledRef.current) void commitRenameTab(tab, renameTabValue)
                              renameTabCancelledRef.current = false
                            }}
                            className="min-h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-left text-[11px] text-[var(--color-pib-text)] outline-none xl:min-h-0"
                          />
                        ) : (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={tab.id === pane.activeTabId}
                            title={tab.kind === 'conversation' ? 'Double-click to rename' : tab.title}
                            onClick={() => {
                              setFocusedPaneId(pane.id)
                              if (tab.kind === 'conversation') {
                                setTabActivityByConversationId((current) => clearTabActivity(current, tab.conversationId))
                              }
                              setPanes((current) => current.map((item) => item.id === pane.id ? { ...item, activeTabId: tab.id } : item))
                            }}
                            onDoubleClick={(event) => {
                              if (tab.kind !== 'conversation') return
                              event.preventDefault()
                              setFocusedPaneId(pane.id)
                              setTabActivityByConversationId((current) => clearTabActivity(current, tab.conversationId))
                              setPanes((current) => current.map((item) => item.id === pane.id ? { ...item, activeTabId: tab.id } : item))
                              beginRenameTab(tab)
                            }}
                            className="min-h-11 min-w-0 flex-1 truncate text-left text-[11px] xl:min-h-0"
                          >
                            {tab.title}
                          </button>
                        )}
                        {tab.kind === 'conversation' && (
                          <button
                            type="button"
                            aria-label={`Park ${tab.title}`}
                            title="Park this tab to stop background activity"
                            onClick={() => parkConversationTab(pane.id, tab)}
                            disabled={tabTransfer !== null}
                            className="ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center self-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] disabled:pointer-events-none xl:h-5 xl:w-5 xl:opacity-0 xl:group-hover/tab:opacity-100 xl:focus:opacity-100"
                          >
                            <Icon name="switch_right" className="block text-[13px] leading-none" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Close ${tab.title}`}
                          onClick={() => closeTab(pane.id, tab.id)}
                          disabled={tabTransfer !== null}
                          className="ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center self-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] disabled:pointer-events-none xl:h-5 xl:w-5 xl:opacity-0 xl:group-hover/tab:opacity-100 xl:focus:opacity-100"
                        >
                          <Icon name="close" className="block text-[12px] leading-none" />
                        </button>
                      </div>
                      )
                    })}
                    {pane.tabs.length === 0 && <span className="px-2 text-[11px] text-[var(--color-pib-text-muted)]">Select a session</span>}
                    {parkedTabsForPane.length > 0 && (
                      <div data-testid="messages-parked-tabs-inline" aria-label="Parked tabs" className="mx-parked-tabs-inline-enter ml-4 flex min-w-0 shrink-0 items-center gap-1 border-l border-[var(--color-card-border)] pl-4">
                        <Icon name="pause_circle" className="text-[14px] text-[var(--color-pib-text-muted)]" />
                        {parkedTabsForPane.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            data-testid={`parked-workspace-tab-${tab.conversationId}`}
                            aria-label={`Resume ${tab.title}`}
                            title={`Resume ${tab.title}`}
                            onClick={() => restoreParkedTab(tab)}
                            style={folderAccentStyle(tab.accentSeed)}
                            disabled={tabTransfer !== null}
                            className={`group/parked relative flex min-h-11 min-w-[92px] max-w-[180px] items-center gap-1 overflow-hidden rounded-md border border-dashed border-[var(--color-pib-line)] px-2 text-left text-[11px] text-[var(--color-pib-text-muted)] hover:border-primary/35 hover:bg-primary/[0.08] hover:text-[var(--color-pib-text)] disabled:pointer-events-none xl:h-6 xl:min-h-0 ${tab.accentSeed ? 'mx-folder-accent' : ''} ${tabTransfer?.id === tab.id && tabTransfer.direction === 'restoring' ? 'mx-parked-tab-restoring' : 'mx-parked-tab-enter'}`}
                          >
                            <Icon name="switch_left" className="text-[13px] text-primary" />
                            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {panes.length > 1 && <button type="button" aria-label={`Show ${alternatePaneId} pane`} onClick={() => setFocusedPaneId(alternatePaneId)} className="grid h-11 w-11 shrink-0 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] xl:hidden"><Icon name="swap_horiz" className="text-[18px]" /></button>}
                  {pane.id === 'secondary' && <button type="button" aria-label="Close split pane" onClick={() => { setPanes((current) => current.filter((item) => item.id !== 'secondary')); setFocusedPaneId('primary') }} className="grid h-11 w-11 shrink-0 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] xl:h-6 xl:w-6"><Icon name="close_fullscreen" className="text-[14px]" /></button>}
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-1">
                  {activeTab?.kind === 'panel' ? <GeneratedWorkspacePanel panel={activeTab.panel} /> : (
                    <UnifiedChat
                      {...chatProps}
                      initialConvId={activeTab?.kind === 'conversation' ? activeTab.conversationId : paneIndex === 0 ? initialConvId : undefined}
                      activeConversationId={activeTab?.kind === 'conversation' ? activeTab.conversationId : null}
                      onActiveConversationChange={(conversationId) => openConversation(pane.id, conversationId)}
                      onConversationLifecycle={handleConversationLifecycle}
                      onRealtimeGatewayConnectionChange={handleRealtimeGatewayConnectionChange}
                      onConversationRealtimeInvalidation={handleConversationRealtimeInvalidation}
                      onConversationsChange={paneIndex === 0 ? handleConversationCatalogue : undefined}
                      syncedConversationTitles={conversationTitles}
                      showConversationList={paneIndex === 0}
                      conversationRailMode={canvasForcesCollapsedRail && paneIndex === 0 ? 'collapsed' : conversationRailMode}
                      onConversationRailModeChange={setConversationRailMode}
                      onContextCanvasPresentationChange={paneIndex === 0 ? ({ open, mode }) => setCanvasForcesCollapsedRail(open && mode === 'dual') : undefined}
                      experienceMode={experienceMode}
                      onExperienceModeChange={handleExperienceModeChange}
                    />
                  )}
                </div>
              </div>
            )
          })}
          {panes.length > 1 && <button type="button" aria-label="Resize workspace panes" style={{ order: 1 }} onPointerDown={startResize} onPointerMove={continueResize} onPointerUp={finishResize} onPointerCancel={finishResize} className={`z-10 hidden shrink-0 touch-none bg-transparent hover:bg-primary/20 focus-visible:bg-primary/20 xl:block ${direction === 'row' ? '-mx-0.5 cursor-col-resize xl:w-2 xl:min-w-0' : '-my-0.5 cursor-row-resize xl:h-2 xl:min-h-0'}`} />}
        </div>
      </section>
    </ModuleShell>
  )
}

export default HermesMessagesShell

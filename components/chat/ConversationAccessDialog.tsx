'use client'

import { useEffect, useMemo, useState } from 'react'

type ShareMode = 'private' | 'shared' | 'org'
type Contact = {
  uid: string
  displayName?: string
  email?: string
  role: 'admin' | 'client'
}

interface AccessConversation {
  id: string
  orgId: string
  startedBy: string
  title: string
  participants: Array<
    | { kind: 'user'; uid: string; role: 'admin' | 'client'; displayName?: string; email?: string }
    | { kind: 'agent'; agentId?: string; name?: string }
  >
  participantUids: string[]
  accessVersion?: number
  workspaceContext?: { shareMode?: string; ownerUserId?: string }
}

interface ConversationAccessDialogProps<T extends AccessConversation> {
  conversation: T
  onClose: () => void
  onUpdated: (conversation: T) => void
}

const OPTIONS: Array<{ value: ShareMode; label: string; description: string; icon: string }> = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only the owner and explicitly invited participants can open it.',
    icon: 'lock',
  },
  {
    value: 'shared',
    label: 'Selected people',
    description: 'Only the owner and the people selected below can open it.',
    icon: 'group',
  },
  {
    value: 'org',
    label: 'Organisation',
    description: 'Authorised members of this organisation can open it. Selected people remain visible as collaborators.',
    icon: 'domain',
  },
]

function labelFor(contact: Contact): string {
  return contact.displayName?.trim() || contact.email?.trim() || contact.uid
}

export default function ConversationAccessDialog<T extends AccessConversation>({
  conversation,
  onClose,
  onUpdated,
}: ConversationAccessDialogProps<T>) {
  const ownerUid = conversation.workspaceContext?.ownerUserId ?? conversation.startedBy
  const workspaceConversation = Boolean(conversation.workspaceContext)
  const initialShareMode = conversation.workspaceContext?.shareMode
  const [shareMode, setShareMode] = useState<ShareMode>(
    initialShareMode === 'shared' || initialShareMode === 'org' ? initialShareMode : 'private',
  )
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedUids, setSelectedUids] = useState<string[]>(() =>
    conversation.participants
      .filter((participant) => participant.kind === 'user')
      .map((participant) => participant.uid),
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Prefer /people because browser privacy lists sometimes block API paths
    // containing "contacts".
    fetch(`/api/v1/orgs/${conversation.orgId}/people`)
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error ?? 'Failed to load people')
        return Array.isArray(body?.data) ? body.data as Contact[] : []
      })
      .then((next) => {
        if (!cancelled) setContacts(next)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Failed to load people')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [conversation.orgId])

  const people = useMemo(() => {
    const byUid = new Map<string, Contact>()
    for (const participant of conversation.participants) {
      if (participant.kind !== 'user') continue
      byUid.set(participant.uid, {
        uid: participant.uid,
        displayName: participant.displayName,
        email: participant.email,
        role: participant.role,
      })
    }
    for (const contact of contacts) byUid.set(contact.uid, { ...byUid.get(contact.uid), ...contact })
    return Array.from(byUid.values()).sort((a, b) => {
      if (a.uid === ownerUid) return -1
      if (b.uid === ownerUid) return 1
      return labelFor(a).localeCompare(labelFor(b))
    })
  }, [contacts, conversation.participants, ownerUid])

  function chooseMode(next: ShareMode) {
    setShareMode(next)
    setError(null)
    if (next === 'private') setSelectedUids([ownerUid])
    else if (!selectedUids.includes(ownerUid)) setSelectedUids((current) => [ownerUid, ...current])
  }

  function togglePerson(uid: string) {
    if (uid === ownerUid || (workspaceConversation && shareMode === 'private')) return
    setSelectedUids((current) => current.includes(uid)
      ? current.filter((value) => value !== uid)
      : [...current, uid])
    setError(null)
  }

  async function save() {
    if (workspaceConversation && shareMode === 'shared' && selectedUids.every((uid) => uid === ownerUid)) {
      setError('Select at least one additional person for selected-people access.')
      return
    }
    const currentMode = initialShareMode === 'shared' || initialShareMode === 'org' ? initialShareMode : 'private'
    const rank: Record<ShareMode, number> = { private: 0, shared: 1, org: 2 }
    const currentHumans = new Set(conversation.participantUids)
    const addedPeople = selectedUids.some((uid) => !currentHumans.has(uid))
    if (((workspaceConversation && rank[shareMode] > rank[currentMode]) || addedPeople) && !window.confirm(
      'This will give additional people access to the full conversation history. Continue?',
    )) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(workspaceConversation ? { shareMode } : {}),
          participantUids: workspaceConversation && shareMode === 'private' ? [ownerUid] : selectedUids,
          expectedAccessVersion: conversation.accessVersion ?? 0,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? 'Failed to update access')
      onUpdated(body.data.conversation as T)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to update access')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-access-title"
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-card-border)] p-5">
          <div>
            <p className="text-[10px] font-label uppercase tracking-[0.2em] text-primary">{workspaceConversation ? 'Workspace access' : 'Team conversation'}</p>
            <h2 id="conversation-access-title" className="mt-1 text-lg font-semibold text-[var(--color-pib-text)]">{workspaceConversation ? 'Manage conversation access' : 'Manage people'}</h2>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{conversation.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close access manager" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </header>

        <div data-testid="conversation-access-scroll-body" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5">
          {workspaceConversation && <fieldset className="space-y-2">
            <legend className="mb-2 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Who can open this conversation?</legend>
            {OPTIONS.map((option) => (
              <label key={option.value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${shareMode === option.value ? 'border-primary/50 bg-primary/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                <input type="radio" name="share-mode" value={option.value} checked={shareMode === option.value} onChange={() => chooseMode(option.value)} className="sr-only" />
                <span className="pib-icon-tint pib-icon-tint-blue mt-0.5"><span className="material-symbols-outlined text-[18px]">{option.icon}</span></span>
                <span>
                  <span className="block text-sm font-medium text-[var(--color-pib-text)]">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-pib-text-muted)]">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>}

          {(!workspaceConversation || shareMode !== 'private') && (
            <fieldset>
              <legend className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{workspaceConversation ? 'Collaborators' : 'People in this chat'}</legend>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{workspaceConversation ? (shareMode === 'shared' ? 'The owner is always retained. Select at least one other person.' : 'The owner is always retained. Selected people are shown as collaborators.') : 'The owner is always retained. Add or remove organisation members from the shared history.'}</p>
              <div className="mt-3 space-y-1.5">
                {loading && <div className="pib-skeleton h-10 w-full" />}
                {!loading && people.map((person) => {
                  const checked = selectedUids.includes(person.uid)
                  const owner = person.uid === ownerUid
                  return (
                    <label key={person.uid} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${checked ? 'border-white/15 bg-white/[0.06]' : 'border-transparent hover:bg-white/[0.03]'} ${owner ? 'cursor-default' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={checked} disabled={owner} onChange={() => togglePerson(person.uid)} className="h-4 w-4 rounded border-white/20 bg-transparent text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--color-pib-text)]">{labelFor(person)}</span>
                        {person.email && person.email !== labelFor(person) && <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">{person.email}</span>}
                      </span>
                      {owner && <span className="pib-pill pib-pill-blue !px-2 !py-0.5">Owner</span>}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}

          {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-card-border)] p-4">
          <button type="button" onClick={onClose} disabled={saving} className="pib-btn-secondary text-xs">Cancel</button>
          <button type="button" onClick={save} disabled={saving || loading} className="pib-btn-primary text-xs">
            {saving ? 'Saving…' : 'Save access'}
          </button>
        </footer>
      </section>
    </div>
  )
}

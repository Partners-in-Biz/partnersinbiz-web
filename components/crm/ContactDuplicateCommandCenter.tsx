'use client'

import { useState } from 'react'

export interface DuplicateContact {
  id: string
  name?: string
  email?: string
  company?: string
  stage?: string
}

export interface DuplicateGroup {
  contacts: DuplicateContact[]
  reason: 'email' | 'name'
}

interface Props {
  groups: DuplicateGroup[]
  mergingGroup: string | null
  onClose: () => void
  onMerge: (groupIndex: number, winnerId: string, loserId: string) => void
}

export function applyContactMergeToDuplicateGroups(
  groups: DuplicateGroup[],
  groupIndex: number,
  loserId: string,
): DuplicateGroup[] {
  return groups.flatMap((group, index) => {
    if (index !== groupIndex) return [group]
    const remainingContacts = group.contacts.filter((contact) => contact.id !== loserId)
    return remainingContacts.length > 1 ? [{ ...group, contacts: remainingContacts }] : []
  })
}

function readableDuplicateContactLabel(value?: string): string {
  const key = value?.trim()
  if (!key) return ''
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function DuplicateGroupResolver({
  group,
  groupIndex,
  isMerging,
  onMerge,
}: {
  group: DuplicateGroup
  groupIndex: number
  isMerging: boolean
  onMerge: (groupIndex: number, winnerId: string, loserId: string) => void
}) {
  const [winnerId, setWinnerId] = useState(group.contacts[0]?.id ?? '')
  const loser = group.contacts.find((contact) => contact.id !== winnerId)
  const remainingMergeCount = Math.max(0, group.contacts.length - 1)

  return (
    <article className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Matched by {group.reason}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">
            {group.contacts.length} records need {remainingMergeCount} merge{remainingMergeCount === 1 ? '' : 's'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-pib-line)] px-2.5 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[14px]">data_check</span>
          One merge at a time
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {group.contacts.map((contact) => {
          const isWinner = winnerId === contact.id
          return (
            <label
              key={contact.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                isWinner
                  ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/10'
                  : 'border-[var(--color-pib-line)] hover:border-[var(--color-pib-line-strong)]'
              }`}
            >
              <input
                type="radio"
                name={`duplicate-winner-${groupIndex}`}
                value={contact.id}
                checked={isWinner}
                onChange={() => setWinnerId(contact.id)}
                className="mt-0.5 accent-[var(--color-pib-accent)]"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--color-pib-text)]">
                  {contact.name || 'Unnamed contact'}
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--color-pib-text-muted)]">
                  {contact.email || 'No email'}
                </span>
                {(contact.company || contact.stage) && (
                  <span className="mt-1 block truncate text-xs text-[var(--color-pib-text-muted)]">
                    {[contact.company, readableDuplicateContactLabel(contact.stage)].filter(Boolean).join(' · ')}
                  </span>
                )}
                {isWinner && (
                  <span className="mt-2 inline-flex text-xs font-medium text-[var(--color-pib-accent)]">
                    Keep as canonical
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          {loser
            ? `Next merge will archive ${loser.name || loser.email || loser.id} into the selected canonical contact.`
            : 'Select a canonical contact to continue.'}
        </p>
        <button
          type="button"
          onClick={() => loser && onMerge(groupIndex, winnerId, loser.id)}
          disabled={isMerging || !loser}
          className="btn-pib-accent text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[14px]">merge</span>
          {isMerging ? 'Merging…' : 'Merge next duplicate'}
        </button>
      </div>
    </article>
  )
}

export function ContactDuplicateCommandCenter({ groups, mergingGroup, onClose, onMerge }: Props) {
  const groupCount = groups.length
  const recordCount = groups.reduce((sum, group) => sum + group.contacts.length, 0)
  const queuedMerges = groups.reduce((sum, group) => sum + Math.max(0, group.contacts.length - 1), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Duplicate hygiene</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Resolve contact conflicts</h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--color-pib-text-muted)]">
            Pick the canonical record, merge one duplicate at a time, and keep reviewing until each match group is clean.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-pib-secondary !p-2"
          aria-label="Close duplicate contacts"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Groups</p>
          <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">
            {groupCount} match group{groupCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Records</p>
          <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">
            {recordCount} record{recordCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Queue</p>
          <p className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">
            {queuedMerges} merge{queuedMerges === 1 ? '' : 's'} queued
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span
                className="material-symbols-outlined rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-3xl text-emerald-300"
                aria-hidden="true"
              >
                verified
              </span>
              <div>
                <p className="eyebrow !text-[10px]">Scan complete</p>
                <h3 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Contact data is clean</h3>
                <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                  No duplicate contacts need review right now. Keep the team moving with clean owner, stage, and
                  follow-up lists.
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="btn-pib-secondary shrink-0 text-xs">
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                arrow_back
              </span>
              Return to contacts
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-3">
              <p className="eyebrow !text-[10px]">Backlog</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">0 merge backlog</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-3">
              <p className="eyebrow !text-[10px]">Team impact</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">Lists stay trustworthy</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/40 p-3">
              <p className="eyebrow !text-[10px]">Next check</p>
              <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">Run after imports</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, index) => (
            <DuplicateGroupResolver
              key={`${group.reason}-${group.contacts.map((contact) => contact.id).join('-')}`}
              group={group}
              groupIndex={index}
              isMerging={mergingGroup === String(index)}
              onMerge={onMerge}
            />
          ))}
        </div>
      )}
    </div>
  )
}

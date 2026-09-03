'use client'

import { useState } from 'react'
import { Icon } from '@/components/studio'

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

function duplicateContactIdentityLabel(contact?: DuplicateContact): string {
  return contact?.name?.trim() || contact?.email?.trim() || 'Unnamed contact'
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
    <article className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Matched by {group.reason}</p>
          <p className="mt-0.5 text-xs font-medium text-[var(--color-pib-text)]">
            {group.contacts.length} records need {remainingMergeCount} merge{remainingMergeCount === 1 ? '' : 's'}
          </p>
        </div>
        <span className="pib-pill pib-pill-accent shrink-0">
          <Icon name="data_check" className="text-[14px]" />
          One merge at a time
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {group.contacts.map((contact) => {
          const isWinner = winnerId === contact.id
          return (
            <label
              key={contact.id}
              className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 transition ${
                isWinner
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-[var(--color-card-border)] hover:bg-white/[0.04]'
              }`}
            >
              <input
                type="radio"
                name={`duplicate-winner-${groupIndex}`}
                value={contact.id}
                checked={isWinner}
                onChange={() => setWinnerId(contact.id)}
                className="mt-0.5 accent-[var(--color-accent-v2)]"
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--color-pib-text)]">
                  {duplicateContactIdentityLabel(contact)}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--color-pib-text-muted)]">
                  {contact.email || 'No email'}
                </span>
                {(contact.company || contact.stage) && (
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--color-pib-text-muted)]">
                    {[contact.company, readableDuplicateContactLabel(contact.stage)].filter(Boolean).join(' · ')}
                  </span>
                )}
                {isWinner && (
                  <span className="mt-1 inline-flex text-[11px] font-medium text-primary">
                    Keep as canonical
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          {loser
            ? `Next merge will archive ${duplicateContactIdentityLabel(loser)} into the selected canonical contact.`
            : 'Select a canonical contact to continue.'}
        </p>
        <button
          type="button"
          onClick={() => loser && onMerge(groupIndex, winnerId, loser.id)}
          disabled={isMerging || !loser}
          className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-50"
        >
          <Icon name="merge" className="text-[14px]" />
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
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Duplicate hygiene</p>
          <h2 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">Resolve contact conflicts</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Pick the canonical record, merge one duplicate at a time, and keep reviewing until each match group is clean.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          aria-label="Close duplicate contacts"
        >
          <Icon name="close" className="text-[16px]" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-lg font-medium leading-6 text-[var(--color-pib-text)]">
            {groupCount} match group{groupCount === 1 ? '' : 's'}
          </p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Groups</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-lg font-medium leading-6 text-[var(--color-pib-text)]">
            {recordCount} record{recordCount === 1 ? '' : 's'}
          </p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Records</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-lg font-medium leading-6 text-[var(--color-pib-text)]">
            {queuedMerges} merge{queuedMerges === 1 ? '' : 's'} queued
          </p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Queue</p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Icon name="verified" className="mt-0.5 grid h-6 w-6 place-items-center rounded-md border border-emerald-400/40 bg-emerald-400/10 text-[16px] text-emerald-100" />
              <div className="min-w-0">
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Scan complete</p>
                <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">Contact data is clean</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  No duplicate contacts need review right now. Keep the team moving with clean owner, stage, and
                  follow-up lists.
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]">
              <Icon name="arrow_back" className="text-[14px]" />
              Return to contacts
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-xs font-medium leading-5 text-[var(--color-pib-text)]">0 merge backlog</p>
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Backlog</p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-xs font-medium leading-5 text-[var(--color-pib-text)]">Lists stay trustworthy</p>
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Team impact</p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-xs font-medium leading-5 text-[var(--color-pib-text)]">Run after imports</p>
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Next check</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
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

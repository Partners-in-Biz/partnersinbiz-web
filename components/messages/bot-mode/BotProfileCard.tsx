'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BotRosterItem } from '@/lib/messages/bot-roster'
import {
  BOT_AVATAR_MAX_BYTES,
  BOT_AVATAR_MIME_TYPES,
  BOT_AVATAR_PICKABLE_STYLES,
  botMailboxView,
  isBotAvatarMimeAllowed,
  resolveBotAvatarStyle,
  type BotAvatarStyle,
  type BotMailboxRecord,
} from '@/lib/messages/bot-profile'
import { Icon } from '@/components/studio'
import { BotAvatar, type BotAvatarActivity } from './BotAvatar'

export type BotAppearancePatch = { avatarUrl: string | null; avatarStyle: BotAvatarStyle }

type ProfileMeta = { canEditLook: boolean; canProvisionMailbox: boolean }

async function readApiError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' && body.error ? body.error : fallback
}

export function BotProfileCard({
  orgId,
  bot,
  pinned = false,
  activity = 'idle',
  onTogglePin,
  onAppearanceSaved,
  onMailboxChanged,
}: {
  orgId: string
  bot: BotRosterItem
  pinned?: boolean
  activity?: BotAvatarActivity
  onTogglePin?: (botId: string) => void
  onAppearanceSaved?: (botId: string, patch: BotAppearancePatch) => void
  onMailboxChanged?: (botId: string, mailbox: BotMailboxRecord | null) => void
}) {
  const [meta, setMeta] = useState<ProfileMeta | null>(null)
  const [savingLook, setSavingLook] = useState(false)
  const [lookError, setLookError] = useState<string | null>(null)
  const [provisioning, setProvisioning] = useState(false)
  const [mailError, setMailError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const base = `/api/v1/orgs/${encodeURIComponent(orgId)}/bots/${encodeURIComponent(bot.id)}`

  useEffect(() => {
    let cancelled = false
    setMeta(null)
    setLookError(null)
    setMailError(null)
    fetch(`${base}/appearance`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return
        const data = body?.data
        if (!data) {
          setMeta({ canEditLook: false, canProvisionMailbox: false })
          return
        }
        setMeta({ canEditLook: data.canEditLook !== false, canProvisionMailbox: data.canProvisionMailbox === true })
        if (data.mailbox !== undefined) onMailboxChanged?.(bot.id, data.mailbox ?? null)
        if (data.avatarStyle && (data.avatarStyle !== bot.avatarStyle || (data.avatarUrl ?? null) !== (bot.avatarUrl ?? null))) {
          onAppearanceSaved?.(bot.id, { avatarUrl: data.avatarUrl ?? null, avatarStyle: data.avatarStyle })
        }
      })
      .catch(() => {
        if (!cancelled) setMeta({ canEditLook: false, canProvisionMailbox: false })
      })
    return () => { cancelled = true }
    // Only refetch when the bot or org changes; the roster item itself updates from our own callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, bot.id])

  const currentStyle = resolveBotAvatarStyle({ avatarUrl: bot.avatarUrl, avatarStyle: bot.avatarStyle })
  const canEditLook = meta?.canEditLook ?? false

  const pickStyle = useCallback(async (style: BotAvatarStyle) => {
    if (savingLook || style === currentStyle) return
    setSavingLook(true)
    setLookError(null)
    try {
      const response = await fetch(`${base}/appearance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarStyle: style }),
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Could not save the look'))
      const body = await response.json().catch(() => null)
      const data = body?.data
      onAppearanceSaved?.(bot.id, {
        avatarUrl: data?.avatarUrl ?? bot.avatarUrl ?? null,
        avatarStyle: data?.avatarStyle ?? style,
      })
    } catch (error) {
      setLookError(error instanceof Error ? error.message : 'Could not save the look')
    } finally {
      setSavingLook(false)
    }
  }, [base, bot.avatarUrl, bot.id, currentStyle, onAppearanceSaved, savingLook])

  const uploadStill = useCallback(async (file: File) => {
    if (!isBotAvatarMimeAllowed(file.type)) {
      setLookError('Use a PNG, JPG, WebP, or GIF image')
      return
    }
    if (file.size > BOT_AVATAR_MAX_BYTES) {
      setLookError('Image is too large. Maximum size is 2MB.')
      return
    }
    setSavingLook(true)
    setLookError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`${base}/avatar`, { method: 'POST', body: formData })
      if (!response.ok) throw new Error(await readApiError(response, 'Upload failed'))
      const body = await response.json().catch(() => null)
      const data = body?.data
      if (typeof data?.avatarUrl === 'string') {
        onAppearanceSaved?.(bot.id, { avatarUrl: data.avatarUrl, avatarStyle: 'image' })
      }
    } catch (error) {
      setLookError(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setSavingLook(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [base, bot.id, onAppearanceSaved])

  const provisionMailbox = useCallback(async () => {
    if (provisioning) return
    setProvisioning(true)
    setMailError(null)
    try {
      const response = await fetch(`${base}/mailbox`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response, 'Could not provision the mailbox'))
      const body = await response.json().catch(() => null)
      onMailboxChanged?.(bot.id, body?.data?.mailbox ?? null)
    } catch (error) {
      setMailError(error instanceof Error ? error.message : 'Could not provision the mailbox')
    } finally {
      setProvisioning(false)
    }
  }, [base, bot.id, onMailboxChanged, provisioning])

  const mailbox = botMailboxView(bot.mailbox)
  const copyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard?.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard is optional; the address stays visible.
    }
  }, [])

  return (
    <section data-testid="bot-profile-card" className="border-b border-[var(--color-pib-line)] p-3">
      <div className="flex items-center gap-3">
        <BotAvatar
          name={bot.name}
          avatarUrl={bot.avatarUrl}
          avatarStyle={bot.avatarStyle}
          colorKey={bot.colorKey}
          activity={activity}
          size={56}
          testId="bot-profile-avatar"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{bot.name}</p>
          <p className="truncate text-[11px] text-[var(--color-pib-text-muted)]">{bot.role}</p>
        </div>
        {onTogglePin ? (
          <button
            type="button"
            data-testid="bot-profile-pin"
            aria-label={pinned ? `Unpin ${bot.name}` : `Pin ${bot.name}`}
            aria-pressed={pinned}
            onClick={() => onTogglePin(bot.id)}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border xl:h-8 xl:w-8 ${
              pinned
                ? 'border-primary/40 bg-primary/[0.12] text-primary'
                : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
            }`}
          >
            <Icon name={pinned ? 'keep_off' : 'keep'} className="text-[16px]" />
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Look</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Avatar style">
          {BOT_AVATAR_PICKABLE_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={currentStyle === style.id}
              data-testid={`bot-avatar-style-${style.id}`}
              disabled={!canEditLook || savingLook}
              onClick={() => void pickStyle(style.id)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-[11px] xl:h-7 ${
                currentStyle === style.id
                  ? 'border-primary/40 bg-primary/[0.12] text-primary'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text)] hover:bg-[var(--color-row-hover)]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <BotAvatar name={style.label} avatarStyle={style.id} colorKey={bot.colorKey} size={16} />
              {style.label}
            </button>
          ))}
          {bot.avatarUrl ? (
            <button
              type="button"
              role="radio"
              aria-checked={currentStyle === 'image'}
              data-testid="bot-avatar-style-image"
              disabled={!canEditLook || savingLook}
              onClick={() => void pickStyle('image')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-[11px] xl:h-7 ${
                currentStyle === 'image'
                  ? 'border-primary/40 bg-primary/[0.12] text-primary'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text)] hover:bg-[var(--color-row-hover)]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Icon name="image" className="text-[14px]" />
              Photo
            </button>
          ) : null}
          <label
            className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-[var(--color-pib-line)] px-2 text-[11px] text-[var(--color-pib-text)] hover:bg-[var(--color-row-hover)] xl:h-7 ${
              !canEditLook || savingLook ? 'cursor-not-allowed opacity-50' : ''
            }`}
          >
            <Icon name="upload" className="text-[14px]" />
            {savingLook ? 'Saving…' : 'Upload'}
            <input
              ref={fileInputRef}
              type="file"
              data-testid="bot-avatar-upload"
              aria-label="Upload avatar image"
              accept={BOT_AVATAR_MIME_TYPES.join(',')}
              disabled={!canEditLook || savingLook}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadStill(file)
              }}
            />
          </label>
        </div>
        <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]">PNG, JPG, WebP, or GIF up to 2MB. Saved for everyone in this workspace.</p>
        {lookError ? <p data-testid="bot-look-error" className="mt-1 text-[10px] text-red-400">{lookError}</p> : null}
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">Email</p>
        {mailbox.state === 'active' ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <code data-testid="bot-mailbox-address" className="min-w-0 flex-1 truncate rounded bg-[var(--color-pib-surface-muted)] px-2 py-1 font-mono text-[11px] text-[var(--color-pib-text)]">
              {mailbox.address}
            </code>
            <button
              type="button"
              aria-label="Copy email address"
              onClick={() => void copyAddress(mailbox.address)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)] xl:h-7 xl:w-7"
            >
              <Icon name={copied ? 'check' : 'content_copy'} className="text-[14px]" />
            </button>
          </div>
        ) : mailbox.state === 'pending' ? (
          <p data-testid="bot-mailbox-status" className="mt-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
            Provisioning{mailbox.address ? ` ${mailbox.address}` : ''}…
          </p>
        ) : mailbox.state === 'error' ? (
          <p data-testid="bot-mailbox-status" className="mt-1.5 text-[11px] text-red-400">{mailbox.error}</p>
        ) : (
          <p data-testid="bot-mailbox-status" className="mt-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
            No mailbox yet. {meta?.canProvisionMailbox ? 'Provision one through the Hermes Mail Agent.' : 'A Bot manager can provision one.'}
          </p>
        )}
        {mailbox.state === 'active' ? (
          <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]">
            {bot.name} sends and receives as this address through the Hermes Mail Agent.
          </p>
        ) : meta?.canProvisionMailbox ? (
          <button
            type="button"
            data-testid="bot-mailbox-provision"
            disabled={provisioning}
            onClick={() => void provisionMailbox()}
            className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 text-[11px] text-[var(--color-pib-text)] hover:bg-[var(--color-row-hover)] disabled:opacity-50 xl:h-7"
          >
            <Icon name="alternate_email" className="text-[14px]" />
            {provisioning ? 'Provisioning…' : 'Provision inbox'}
          </button>
        ) : null}
        {mailError ? <p data-testid="bot-mailbox-error" className="mt-1 text-[10px] leading-4 text-red-400">{mailError}</p> : null}
      </div>
    </section>
  )
}

'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'

export interface BotStudioDevice {
  deviceId: string
  label?: string | null
  deviceKind?: string | null
  supportsCustomAgents?: boolean
}

export function BotStudioPanel({
  devices,
  canCreate = false,
  creating = false,
  importing = false,
  error = null,
  onCreateBot,
  onImportBot,
}: {
  devices: BotStudioDevice[]
  canCreate?: boolean
  creating?: boolean
  importing?: boolean
  error?: string | null
  onCreateBot?: (input: { name: string; role: string; persona: string; deviceId: string; agentHandle?: string }) => void
  onImportBot?: (input: { shareId: string; deviceId: string }) => void
}) {
  const readyDevices = devices.filter((device) => device.supportsCustomAgents !== false)
  if (!onCreateBot && !onImportBot) return null
  return (
    <section data-testid="bot-studio-panel" className="grid gap-3 sm:grid-cols-2">
      {onCreateBot && (
        <form
          className="rounded-lg border border-white/[0.08] bg-black/20 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            onCreateBot({
              name: String(data.get('name') || '').trim(),
              role: String(data.get('role') || '').trim(),
              persona: String(data.get('persona') || '').trim(),
              deviceId: String(data.get('deviceId') || '').trim(),
              agentHandle: String(data.get('agentHandle') || '').trim() || undefined,
            })
          }}
        >
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.createBotLabel}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">A durable GrokBot identity on a linked computer or VPS, shareable beyond the org roster.</p>
          <input name="name" required placeholder="Name" className="mt-2 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-2 text-[12px] text-[var(--color-pib-text)]" />
          <input name="role" required placeholder="Role" className="mt-1 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-2 text-[12px] text-[var(--color-pib-text)]" />
          <input name="agentHandle" placeholder="handle (optional)" className="mt-1 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-2 text-[12px] text-[var(--color-pib-text)]" />
          <textarea name="persona" required placeholder="Purpose and behaviour" rows={3} className="mt-1 w-full rounded border border-white/[0.08] bg-black/30 px-2 py-1 text-[12px] text-[var(--color-pib-text)]" />
          <select name="deviceId" required className="mt-1 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-1 text-[11px] text-[var(--color-pib-text)]">
            {readyDevices.length === 0 ? <option value="">No compatible computer</option> : readyDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.deviceKind === 'vps' ? 'VPS' : 'Computer'} · {device.label || device.deviceId}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!canCreate || creating || readyDevices.length === 0}
            className="mt-2 inline-flex h-8 items-center rounded-md border border-white/[0.1] px-3 text-xs text-[var(--color-pib-text)] hover:bg-white/[0.06] disabled:opacity-40"
          >
            {creating ? 'Creating…' : 'Create Bot'}
          </button>
        </form>
      )}
      {onImportBot && (
        <form
          className="rounded-lg border border-white/[0.08] bg-black/20 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            onImportBot({
              shareId: String(data.get('shareId') || '').trim(),
              deviceId: String(data.get('deviceId') || '').trim(),
            })
          }}
        >
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.importBotLabel}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Paste a share link to clone a custom Bot onto your computer.</p>
          <input name="shareId" required placeholder="bs_… or share URL" className="mt-2 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-2 text-[12px] text-[var(--color-pib-text)]" />
          <select name="deviceId" required className="mt-1 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-1 text-[11px] text-[var(--color-pib-text)]">
            {readyDevices.length === 0 ? <option value="">No compatible computer</option> : readyDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.deviceKind === 'vps' ? 'VPS' : 'Computer'} · {device.label || device.deviceId}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={importing || readyDevices.length === 0}
            className="mt-2 inline-flex h-8 items-center rounded-md border border-white/[0.1] px-3 text-xs text-[var(--color-pib-text)] hover:bg-white/[0.06] disabled:opacity-40"
          >
            {importing ? 'Importing…' : 'Import Bot'}
          </button>
        </form>
      )}
      {error ? <p className="sm:col-span-2 text-xs text-red-300">{error}</p> : null}
    </section>
  )
}

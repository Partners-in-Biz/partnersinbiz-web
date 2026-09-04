'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import {
  CreateAgentOnMachineForm,
  type CreateAgentOnMachineValues,
} from '@/components/agents/CreateAgentOnMachineForm'

export interface BotStudioDevice {
  deviceId: string
  runtimeTargetId?: string | null
  label?: string | null
  deviceKind?: string | null
  ownerType?: 'user' | 'organization' | string | null
  supportsCustomAgents?: boolean
}

export function BotStudioPanel({
  devices,
  defaultDeviceId = '',
  members = [],
  canCreate = false,
  creating = false,
  importing = false,
  error = null,
  onCreateBot,
  onImportBot,
}: {
  devices: BotStudioDevice[]
  defaultDeviceId?: string
  members?: Array<{ uid: string; displayName?: string | null; email?: string | null }>
  canCreate?: boolean
  creating?: boolean
  importing?: boolean
  error?: string | null
  onCreateBot?: (input: CreateAgentOnMachineValues) => void
  onImportBot?: (input: { shareId: string; deviceId: string }) => void
}) {
  const readyDevices = devices.filter((device) => device.supportsCustomAgents !== false)
  if (!onCreateBot && !onImportBot) return null
  return (
    <section data-testid="bot-studio-panel" className="grid gap-3 sm:grid-cols-2">
      {onCreateBot && (
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.createBotLabel}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Create a Bot on the selected computer. It appears in this roster only after that machine hosts it.</p>
          <CreateAgentOnMachineForm
            devices={devices}
            defaultDeviceId={defaultDeviceId}
            members={members}
            compact
            creating={creating}
            canCreate={canCreate}
            submitLabel="Create Bot"
            onSubmit={onCreateBot}
          />
        </div>
      )}
      {onImportBot && (
        <form
          className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-3"
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
          <input name="shareId" required placeholder="bs_… or share URL" className="mt-2 h-8 w-full rounded border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_30%,transparent)] px-2 text-[12px] text-[var(--color-pib-text)]" />
          <select name="deviceId" required className="mt-1 h-8 w-full rounded border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_30%,transparent)] px-1 text-[11px] text-[var(--color-pib-text)]">
            {readyDevices.length === 0 ? <option value="">No compatible computer</option> : readyDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.deviceKind === 'vps' ? 'VPS' : 'Computer'} · {device.label || device.deviceId}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={importing || readyDevices.length === 0}
            className="mt-2 inline-flex h-8 items-center rounded-md border border-[var(--color-pib-line)] px-3 text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)] disabled:opacity-40"
          >
            {importing ? 'Importing…' : 'Import Bot'}
          </button>
        </form>
      )}
      {error ? <p className="sm:col-span-2 text-xs text-red-300">{error}</p> : null}
    </section>
  )
}

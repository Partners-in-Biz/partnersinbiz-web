'use client'

export function RoomDriftBanner({
  orgId,
  projectionId,
  profile,
  onResolved,
}: {
  orgId: string
  projectionId: string
  profile: string
  onResolved?: () => void
}) {
  async function post(action: 'adopt' | 'revert') {
    const response = await fetch(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/agent-rooms/drift/${encodeURIComponent(projectionId)}/${action}`,
      { method: 'POST' },
    )
    if (!response.ok) return
    onResolved?.()
  }

  return (
    <div
      role="status"
      className="space-y-2 rounded-[4px] border border-[color-mix(in_srgb,var(--st-warning)_35%,var(--color-pib-line))] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-3 py-2"
    >
      <p className="text-xs text-[var(--color-pib-text)]">
        {profile} drifted from the projected room roster.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-pib-primary btn-pib-sm" onClick={() => void post('adopt')}>
          Adopt
        </button>
        <button type="button" className="btn-pib-secondary btn-pib-sm" onClick={() => void post('revert')}>
          Revert
        </button>
      </div>
    </div>
  )
}

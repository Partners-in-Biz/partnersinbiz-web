'use client'
// components/ads/linkedin/audience-builders/AppAudienceInfoCard.tsx
// LinkedIn App audience — info-only card with workaround guidance — Phase 3 Batch 3

interface Props {
  onSwitchToCustomerList?: () => void
  onCancel?: () => void
}

export function LinkedinAppAudienceInfoCard({ onSwitchToCustomerList, onCancel }: Props) {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold">App audiences on LinkedIn</h3>
        <p className="text-sm text-white/60 mt-1">
          LinkedIn does not offer a native App audience equivalent to Meta or Google.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Recommended workaround:</p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-white/70">
          <li>
            Create a{' '}
            <strong className="text-white">Customer List</strong> audience seeded by your app
            analytics events (export user emails or phone hashes).
          </li>
          <li>
            Create a{' '}
            <strong className="text-white">Lookalike</strong> audience from that list to expand to
            similar LinkedIn members.
          </li>
        </ol>
      </div>

      <div className="flex gap-3 pt-2">
        {onSwitchToCustomerList && (
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={onSwitchToCustomerList}
          >
            Create Customer List instead →
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn-pib-ghost text-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

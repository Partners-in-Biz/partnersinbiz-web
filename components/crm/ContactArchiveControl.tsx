'use client'

export function ContactArchiveControl({
  contactName,
  archiving = false,
  onArchive,
}: {
  contactName: string
  archiving?: boolean
  onArchive: () => void
}) {
  function handleArchive() {
    if (!window.confirm(`Archive ${contactName}?`)) return
    onArchive()
  }

  return (
    <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-100">Archive contact</p>
          <p className="mt-1 text-xs leading-5 text-red-100/70">
            Soft-archive this CRM record when it should leave active lists but remain recoverable in audit history.
          </p>
        </div>
        <button
          type="button"
          onClick={handleArchive}
          disabled={archiving}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[15px]">archive</span>
          {archiving ? 'Archiving...' : 'Archive contact'}
        </button>
      </div>
    </div>
  )
}

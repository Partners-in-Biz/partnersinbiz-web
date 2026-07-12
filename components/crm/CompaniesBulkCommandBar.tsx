'use client'

export const COMPANY_BULK_ACTIONS = ['lifecycleStage', 'tier', 'size', 'industry', 'tags', 'accountManagerUid'] as const
export type CompanyBulkActionKey = typeof COMPANY_BULK_ACTIONS[number]

const ACTION_LABELS: Record<CompanyBulkActionKey, string> = {
  lifecycleStage: 'Lifecycle stage',
  tier: 'Account tier',
  size: 'Company size',
  industry: 'Industry',
  tags: 'Replace tags',
  accountManagerUid: 'Account manager',
}

const LIFECYCLE_STAGES = ['lead', 'prospect', 'customer', 'churned'] as const
const TIERS = ['enterprise', 'mid-market', 'smb'] as const
const SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const

const LABEL_CLS = 'text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant'
const CONTROL_CLS = 'h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface focus:outline-none'

interface Props {
  selectedCount: number
  totalCount: number
  bulkAction: CompanyBulkActionKey
  bulkPending: boolean
  lifecycleStage: string
  tier: string
  size: string
  industry: string
  tagsInput: string
  accountManagerUid: string
  onActionChange: (action: CompanyBulkActionKey) => void
  onLifecycleStageChange: (value: string) => void
  onTierChange: (value: string) => void
  onSizeChange: (value: string) => void
  onIndustryChange: (value: string) => void
  onTagsInputChange: (value: string) => void
  onAccountManagerUidChange: (value: string) => void
  onClear: () => void
  onApply: () => void
}

export function CompaniesBulkCommandBar({
  selectedCount,
  totalCount,
  bulkAction,
  bulkPending,
  lifecycleStage,
  tier,
  size,
  industry,
  tagsInput,
  accountManagerUid,
  onActionChange,
  onLifecycleStageChange,
  onTierChange,
  onSizeChange,
  onIndustryChange,
  onTagsInputChange,
  onAccountManagerUidChange,
  onClear,
  onApply,
}: Props) {
  const coverage = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0
  const actionLabel = ACTION_LABELS[bulkAction]

  return (
    <section
      className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 p-3 space-y-3"
      aria-label="Account bulk command center"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-card-border)] pb-2">
        <div className="min-w-0">
          <p className={LABEL_CLS}>Account bulk command center</p>
          <h2 className="mt-1 text-sm font-semibold text-on-surface">Move selected accounts as one governed set.</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-on-surface-variant">
            Standardise lifecycle, tier, size, industry, owner, or tags without opening each company record.
          </p>
        </div>
        <button
          onClick={onClear}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
          aria-label="Clear selected companies"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
          Clear selection
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className={LABEL_CLS}>Selected accounts</p>
          <p className="mt-1 text-lg font-semibold text-on-surface">{selectedCount} selected</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className={LABEL_CLS}>Coverage</p>
          <p className="mt-1 text-lg font-semibold text-on-surface">{coverage}%</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className={LABEL_CLS}>Next operation</p>
          <p className="mt-1 text-xs text-on-surface">{actionLabel}</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className={LABEL_CLS}>Safety</p>
          <p className="mt-1 text-xs text-on-surface-variant">No destructive action in this panel.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-end gap-2 lg:grid-cols-[minmax(180px,240px)_1fr_auto]">
        <label className="space-y-1">
          <span className={LABEL_CLS}>Operation</span>
          <select
            aria-label="Company bulk action"
            value={bulkAction}
            onChange={(event) => onActionChange(event.target.value as CompanyBulkActionKey)}
            className={CONTROL_CLS}
          >
            {COMPANY_BULK_ACTIONS.map(action => (
              <option key={action} value={action} className="bg-black">
                {ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>

        <div>
          {bulkAction === 'lifecycleStage' && (
            <label className="space-y-1 block">
              <span className={LABEL_CLS}>Lifecycle stage</span>
              <select value={lifecycleStage} onChange={(event) => onLifecycleStageChange(event.target.value)} className={CONTROL_CLS}>
                {LIFECYCLE_STAGES.map(stage => <option key={stage} value={stage} className="bg-black">{stage}</option>)}
              </select>
            </label>
          )}

          {bulkAction === 'tier' && (
            <label className="space-y-1 block">
              <span className={LABEL_CLS}>Tier</span>
              <select value={tier} onChange={(event) => onTierChange(event.target.value)} className={CONTROL_CLS}>
                {TIERS.map(value => <option key={value} value={value} className="bg-black">{value}</option>)}
              </select>
            </label>
          )}

          {bulkAction === 'size' && (
            <label className="space-y-1 block">
              <span className={LABEL_CLS}>Size</span>
              <select value={size} onChange={(event) => onSizeChange(event.target.value)} className={CONTROL_CLS}>
                {SIZES.map(value => <option key={value} value={value} className="bg-black">{value}</option>)}
              </select>
            </label>
          )}

          {bulkAction === 'industry' && (
            <label className="space-y-1 block">
              <span className={LABEL_CLS}>Industry</span>
              <input value={industry} onChange={(event) => onIndustryChange(event.target.value)} placeholder="SaaS, legal, property..." className={CONTROL_CLS} />
            </label>
          )}

          {bulkAction === 'tags' && (
            <label className="space-y-1 block">
              <span className={LABEL_CLS}>Tags</span>
              <input value={tagsInput} onChange={(event) => onTagsInputChange(event.target.value)} placeholder="priority, retained..." className={CONTROL_CLS} />
            </label>
          )}

          {bulkAction === 'accountManagerUid' && (
            <label className="space-y-1 block">
              <span className={LABEL_CLS}>Account manager UID</span>
              <input value={accountManagerUid} onChange={(event) => onAccountManagerUidChange(event.target.value)} placeholder="User UID..." className={CONTROL_CLS} />
            </label>
          )}
        </div>

        <button
          onClick={onApply}
          disabled={bulkPending}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Apply company bulk updates"
        >
          <span className="material-symbols-outlined text-[16px]">done_all</span>
          {bulkPending ? 'Applying...' : 'Apply updates'}
        </button>
      </div>
    </section>
  )
}

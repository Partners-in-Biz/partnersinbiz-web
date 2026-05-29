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
      className="pib-card-section p-4 space-y-4 shadow-xl"
      aria-label="Account bulk command center"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Account bulk command center</p>
          <h2 className="font-display text-xl mt-1">Move selected accounts as one governed set.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 max-w-2xl">
            Standardise lifecycle, tier, size, industry, owner, or tags without opening each company record.
          </p>
        </div>
        <button
          onClick={onClear}
          className="btn-pib-secondary !text-xs"
          aria-label="Clear selected companies"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
          Clear selection
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Selected accounts</p>
          <p className="font-display text-2xl mt-1">{selectedCount} selected</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Coverage</p>
          <p className="font-display text-2xl mt-1">{coverage}%</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Next operation</p>
          <p className="text-sm mt-1 text-[var(--color-pib-text)]">{actionLabel}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
          <p className="eyebrow !text-[10px]">Safety</p>
          <p className="text-sm mt-1 text-[var(--color-pib-text-muted)]">No destructive action in this panel.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(180px,240px)_1fr_auto] gap-3 items-end">
        <label className="space-y-1">
          <span className="eyebrow !text-[10px]">Operation</span>
          <select
            aria-label="Company bulk action"
            value={bulkAction}
            onChange={(event) => onActionChange(event.target.value as CompanyBulkActionKey)}
            className="pib-input !w-full !py-2 !text-sm"
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
              <span className="eyebrow !text-[10px]">Lifecycle stage</span>
              <select value={lifecycleStage} onChange={(event) => onLifecycleStageChange(event.target.value)} className="pib-input !w-full !py-2 !text-sm">
                {LIFECYCLE_STAGES.map(stage => <option key={stage} value={stage} className="bg-black">{stage}</option>)}
              </select>
            </label>
          )}

          {bulkAction === 'tier' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Tier</span>
              <select value={tier} onChange={(event) => onTierChange(event.target.value)} className="pib-input !w-full !py-2 !text-sm">
                {TIERS.map(value => <option key={value} value={value} className="bg-black">{value}</option>)}
              </select>
            </label>
          )}

          {bulkAction === 'size' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Size</span>
              <select value={size} onChange={(event) => onSizeChange(event.target.value)} className="pib-input !w-full !py-2 !text-sm">
                {SIZES.map(value => <option key={value} value={value} className="bg-black">{value}</option>)}
              </select>
            </label>
          )}

          {bulkAction === 'industry' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Industry</span>
              <input value={industry} onChange={(event) => onIndustryChange(event.target.value)} placeholder="SaaS, legal, property..." className="pib-input !w-full !py-2 !text-sm" />
            </label>
          )}

          {bulkAction === 'tags' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Tags</span>
              <input value={tagsInput} onChange={(event) => onTagsInputChange(event.target.value)} placeholder="priority, retained..." className="pib-input !w-full !py-2 !text-sm" />
            </label>
          )}

          {bulkAction === 'accountManagerUid' && (
            <label className="space-y-1 block">
              <span className="eyebrow !text-[10px]">Account manager UID</span>
              <input value={accountManagerUid} onChange={(event) => onAccountManagerUidChange(event.target.value)} placeholder="User UID..." className="pib-input !w-full !py-2 !text-sm" />
            </label>
          )}
        </div>

        <button
          onClick={onApply}
          disabled={bulkPending}
          className="btn-pib-accent !py-2.5 !text-sm justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Apply company bulk updates"
        >
          <span className="material-symbols-outlined text-[16px]">done_all</span>
          {bulkPending ? 'Applying...' : 'Apply updates'}
        </button>
      </div>
    </section>
  )
}

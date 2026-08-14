'use client'

import {
  PROFILE_LINK_FIELDS,
  type ProfileLink,
  type ProfileLinkFieldKey,
  type ProfileLinkFieldValues,
} from '@/lib/crm/profileLinks'

type ProfileLinksFieldsProps = {
  values: ProfileLinkFieldValues
  otherLinks: ProfileLink[]
  onChange: (values: ProfileLinkFieldValues) => void
  onOtherLinksChange: (links: ProfileLink[]) => void
  includeWebsite?: boolean
  idPrefix: string
  ariaPrefix?: string
}

export function ProfileLinksFields({
  values,
  otherLinks,
  onChange,
  onOtherLinksChange,
  includeWebsite = true,
  idPrefix,
  ariaPrefix,
}: ProfileLinksFieldsProps) {
  const fields = PROFILE_LINK_FIELDS.filter((field) => includeWebsite || field.key !== 'website')

  function setField(key: ProfileLinkFieldKey, value: string) {
    onChange({ ...values, [key]: value })
  }

  function setOtherLink(index: number, patch: Partial<ProfileLink>) {
    onOtherLinksChange(otherLinks.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `${idPrefix}-${field.key}`
          const label = ariaPrefix ? `${field.label} for ${ariaPrefix}` : field.label
          return (
            <div key={field.key} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                {field.label}
              </label>
              <input
                id={id}
                type="text"
                inputMode="url"
                autoComplete="url"
                aria-label={label}
                value={values[field.key] ?? ''}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60"
              />
            </div>
          )
        })}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Other links</p>
          <button
            type="button"
            aria-label="Add another link"
            onClick={() => onOtherLinksChange([...otherLinks, { label: '', url: '' }])}
            className="h-7 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            Add link
          </button>
        </div>
        {otherLinks.length === 0 ? (
          <p className="text-[11px] text-[var(--color-pib-text-muted)]">
            Add any extra profile or property URL — portfolio, blog, Crunchbase, docs.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {otherLinks.map((link, index) => {
              const labelId = `${idPrefix}-other-label-${index}`
              const urlId = `${idPrefix}-other-url-${index}`
              return (
                <div key={`${labelId}-${urlId}`} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_auto] items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={labelId} className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Label
                    </label>
                    <input
                      id={labelId}
                      type="text"
                      aria-label={`Extra link ${index + 1} label`}
                      value={link.label}
                      onChange={(e) => setOtherLink(index, { label: e.target.value })}
                      placeholder="GitLab"
                      className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={urlId} className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      URL
                    </label>
                    <input
                      id={urlId}
                      type="text"
                      inputMode="url"
                      aria-label={`Extra link ${index + 1} URL`}
                      value={link.url}
                      onChange={(e) => setOtherLink(index, { url: e.target.value })}
                      placeholder="https://…"
                      className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)]"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={ariaPrefix ? `Remove ${ariaPrefix.toLowerCase()} extra link ${index + 1}` : `Remove extra link ${index + 1}`}
                    onClick={() => onOtherLinksChange(otherLinks.filter((_, i) => i !== index))}
                    className="grid h-9 w-9 place-items-center rounded-md border border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

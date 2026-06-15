'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ThemedSelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

type ThemedSelectProps = {
  id?: string
  ariaLabel: string
  value: string
  options: ThemedSelectOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
  buttonChrome?: 'default' | 'custom'
  buttonClassName?: string
  valueClassName?: string
  menuClassName?: string
  optionClassName?: string
  buttonTestId?: string
  renderValue?: (option: ThemedSelectOption | undefined) => ReactNode
}

export function ThemedSelect({
  id,
  ariaLabel,
  value,
  options,
  onValueChange,
  disabled,
  className,
  buttonChrome = 'default',
  buttonClassName,
  valueClassName,
  menuClassName,
  optionClassName,
  buttonTestId,
  renderValue,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const listboxId = id ? `${id}-listbox` : undefined

  useEffect(() => {
    if (!open) return

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative inline-flex min-w-0', className)}>
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        data-testid={buttonTestId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(
          buttonChrome === 'default' &&
            'inline-flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none transition-colors hover:bg-white/[0.04] focus:border-[var(--color-pib-accent)] disabled:cursor-not-allowed disabled:opacity-60',
          buttonClassName,
        )}
      >
        <span className={cn('min-w-0 truncate text-left', valueClassName)}>
          {renderValue ? renderValue(selected) : selected?.label}
        </span>
        <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] text-current">
          expand_more
        </span>
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute left-0 top-full z-50 mt-1 max-h-64 min-w-full overflow-y-auto rounded-lg border border-[var(--color-pib-line-strong)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] shadow-2xl',
            menuClassName,
          )}
        >
          {options.map((option) => {
            const selectedOption = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                aria-disabled={option.disabled}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return
                  onValueChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50',
                  selectedOption ? 'text-[var(--color-pib-accent-hover)]' : 'text-[var(--color-pib-text)]',
                  optionClassName,
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {selectedOption ? (
                  <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[16px]">
                    check
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/studio'
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
  /**
   * @deprecated Prefer Studio defaults. `custom` skips `.st-select` so callers can supply their own chrome via `buttonClassName`.
   */
  buttonChrome?: 'default' | 'custom'
  buttonClassName?: string
  valueClassName?: string
  /** @deprecated Popover uses raised-paper `st-menu__list`; extra classes are still merged. */
  menuClassName?: string
  /** @deprecated Option rows use `st-menu__item`; extra classes are still merged. */
  optionClassName?: string
  buttonTestId?: string
  renderValue?: (option: ThemedSelectOption | undefined) => ReactNode
}

/**
 * Themed select with a frozen public API.
 *
 * Default trigger: `.st-select`. Option popover: Studio Menu surface
 * (`.st-menu` / `.st-menu__list` / `.st-menu__item`  -  same markup Menu ships).
 *
 * The Studio `Menu` component is not mounted here: it always wraps its trigger
 * in a secondary `Button` and uses `role="menu"`, which would break listbox
 * semantics, `buttonChrome="custom"`, `id`, and `buttonTestId`.
 */
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
    <div ref={rootRef} className={cn('st-menu relative inline-flex min-w-0', className)}>
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
            'st-select inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 text-left outline-none disabled:cursor-not-allowed disabled:opacity-60',
          buttonClassName,
        )}
      >
        <span className={cn('min-w-0 truncate text-left', valueClassName)}>
          {renderValue ? renderValue(selected) : selected?.label}
        </span>
        <Icon name="expand_more" className="shrink-0" />
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn('st-menu__list max-h-64 min-w-full overflow-y-auto', menuClassName)}
        >
          {options.map((option) => {
            const selectedOption = option.value === value
            return (
              <li key={option.value} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedOption}
                  aria-disabled={option.disabled}
                  disabled={option.disabled}
                  data-active={selectedOption ? 'true' : undefined}
                  onClick={() => {
                    if (option.disabled) return
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                  className={cn('st-menu__item disabled:cursor-not-allowed disabled:opacity-50', optionClassName)}
                >
                  <span className="inline-flex w-full items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{option.label}</span>
                    {selectedOption ? <Icon name="check" className="shrink-0" /> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

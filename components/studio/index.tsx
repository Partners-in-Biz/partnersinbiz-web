'use client'

import Link from 'next/link'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import './studio-ui.css'

/**
 * Studio UI primitives for auth, portal and admin screens (brand-system.md
 * section 11). Tokens are global via app/studio-tokens.css (paper default;
 * ink via data-theme="ink" or .sc-ink). Class names are stable and documented
 * in studio-ui.css so server components can use them directly.
 *
 * Input/Textarea/Select are label-agnostic on purpose: `Field` supplies the
 * `<label htmlFor>`. The static design-audit gate cannot see that pairing, so
 * this file is listed in .impeccable/config.json; consumers are still audited.
 */

type Tone = 'success' | 'warning' | 'danger' | 'info'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export function Panel({
  children,
  flat = false,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  flat?: boolean
  className?: string
  as?: 'div' | 'section' | 'form' | 'article'
}) {
  return <Tag className={cx('st-panel', flat && 'st-panel--flat', className)}>{children}</Tag>
}

export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('st-stack', className)}>{children}</div>
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('st-row', className)}>{children}</div>
}

export function Title({ children, as: Tag = 'h2', className }: { children: ReactNode; as?: 'h1' | 'h2' | 'h3'; className?: string }) {
  return <Tag className={cx('st-title', className)}>{children}</Tag>
}

/* ── Buttons ────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonBase {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  block?: boolean
  loading?: boolean
  className?: string
  children: ReactNode
}

function buttonClass({ variant = 'primary', size = 'md', block = false, className }: ButtonBase): string {
  return cx('st-btn', `st-btn--${variant}`, size === 'sm' && 'st-btn--sm', block && 'st-btn--block', className)
}

export function Button({
  variant,
  size,
  block,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonBase & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, className, children })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="st-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function ButtonLink({
  href,
  variant,
  size,
  block,
  className,
  children,
  prefetch = false,
}: ButtonBase & { href: string; prefetch?: boolean }) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClass({ variant, size, block, className, children })}>
      {children}
    </Link>
  )
}

/* ── Fields ─────────────────────────────────────────────────────────────── */

/**
 * Label above, control, then help or error. The `id` links label and control
 * so the design-audit gate never sees an unlabeled input.
 */
export function Field({
  id,
  label,
  hint,
  help,
  error,
  children,
}: {
  id: string
  label: ReactNode
  /** Right-aligned note in the label row, e.g. "Optional". */
  hint?: ReactNode
  help?: ReactNode
  error?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="st-field">
      <label htmlFor={id} className="sc-tiny st-label">
        <span>{label}</span>
        {hint && <span className="st-label__hint">{hint}</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="st-error" role="alert">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="st-help">
          {help}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx('st-input', className)} aria-invalid={invalid || undefined} {...rest} />
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cx('st-textarea', className)} aria-invalid={invalid || undefined} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('st-select', className)} {...rest}>
      {children}
    </select>
  )
}

/* ── Choices ────────────────────────────────────────────────────────────── */

export function ChoiceGrid({ cols = 2, children, className }: { cols?: number; children: ReactNode; className?: string }) {
  return (
    <div className={cx('st-choice-grid', className)} style={{ ['--st-cols' as string]: cols }}>
      {children}
    </div>
  )
}

export function Choice({
  selected = false,
  center = false,
  mono = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; center?: boolean; mono?: boolean }) {
  return (
    <button
      type={type}
      className={cx('st-choice', center && 'st-choice--center', mono && 'st-choice--mono', className)}
      aria-pressed={selected}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ── Progress, status, notices ──────────────────────────────────────────── */

export function Steps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="st-steps sc-tiny" aria-label="Progress">
      {steps.map((label, i) => (
        <li
          key={label}
          className={cx('st-steps__item', i < current && 'st-steps__item--done')}
          aria-current={i === current ? 'step' : undefined}
        >
          {String(i + 1).padStart(2, '0')} {label}
        </li>
      ))}
    </ol>
  )
}

export function Status({ tone, children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('st-status sc-tiny', tone && `st-status--${tone}`, className)}>{children}</span>
}

export function Notice({
  tone,
  title,
  children,
  role,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  role?: 'status' | 'alert'
}) {
  return (
    <div className={cx('st-notice sc-body', tone && `st-notice--${tone}`)} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
    </div>
  )
}

/* ── Checkbox / Switch / Radio ──────────────────────────────────────────── */

export function Checkbox({
  label,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label className={cx('st-checkbox', className)} htmlFor={inputId}>
      <input id={inputId} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  )
}

export function Switch({
  label,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & { label: ReactNode }) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <label className={cx('st-switch', className)} htmlFor={inputId}>
      <input id={inputId} type="checkbox" role="switch" {...rest} />
      <span>{label}</span>
    </label>
  )
}

export function RadioGroup({
  name,
  label,
  options,
  value,
  onChange,
  className,
}: {
  name: string
  label?: ReactNode
  options: readonly { value: string; label: ReactNode }[]
  value?: string
  onChange?: (value: string) => void
  className?: string
}) {
  const groupId = useId()
  return (
    <div className={cx('st-radio-group', className)} role="radiogroup" aria-labelledby={label ? `${groupId}-label` : undefined}>
      {label && (
        <div id={`${groupId}-label`} className="sc-tiny">
          {label}
        </div>
      )}
      {options.map((opt) => {
        const id = `${groupId}-${opt.value}`
        return (
          <label key={opt.value} className="st-radio" htmlFor={id}>
            <input
              id={id}
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange?.(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        )
      })}
    </div>
  )
}

/* ── Menu ───────────────────────────────────────────────────────────────── */

export function Menu({
  trigger,
  items,
  label,
}: {
  trigger: ReactNode
  label: string
  items: readonly { id: string; label: ReactNode; onSelect?: () => void; disabled?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="st-menu" ref={rootRef}>
      <Button
        type="button"
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </Button>
      {open && (
        <ul className="st-menu__list" role="menu" aria-label={label}>
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="st-menu__item"
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.()
                  setOpen(false)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Table ──────────────────────────────────────────────────────────────── */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cx('st-table', className)}>{children}</table>
}
export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>
}
export function TFoot({ children }: { children: ReactNode }) {
  return <tfoot>{children}</tfoot>
}
export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>
}
export function TH({ children, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cx('sc-tiny', className)} {...rest}>
      {children}
    </th>
  )
}
export function TD({ children, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cx(className)} {...rest}>
      {children}
    </td>
  )
}

/* ── DataList ───────────────────────────────────────────────────────────── */

export function DataList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx('st-datalist', className)}>{children}</dl>
}

export function DataItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="st-datalist__item">
      <dt className="sc-tiny">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/* ── Avatar / Toolbar / Pagination / Crumbs / Skeleton / Icon ───────────── */

export function Avatar({
  initials,
  src,
  alt = '',
  size = 'md',
  className,
}: {
  initials?: string
  src?: string
  alt?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span className={cx('st-avatar', size !== 'md' && `st-avatar--${size}`, className)} aria-hidden={src ? undefined : !alt}>
      {src ? <img src={src} alt={alt} /> : (initials ?? '?')}
    </span>
  )
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('st-toolbar', className)}>{children}</div>
}

export function Pagination({
  from,
  to,
  total,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: {
  from: number
  to: number
  total: number
  onPrev?: () => void
  onNext?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}) {
  return (
    <div className="st-pagination">
      <p className="sc-tiny" style={{ margin: 0 }}>
        Showing {from} to {to} of {total}
      </p>
      <div className="st-pagination__actions">
        <Button type="button" variant="ghost" size="sm" onClick={onPrev} disabled={prevDisabled}>
          Previous
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onNext} disabled={nextDisabled}>
          Next
        </Button>
      </div>
    </div>
  )
}

export function Crumbs({
  items,
}: {
  items: readonly { href?: string; label: ReactNode }[]
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="st-crumbs sc-tiny">
        {items.map((item, i) => (
          <li key={i}>
            {i > 0 && <span className="st-crumbs__sep" aria-hidden="true"> / </span>}
            {item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Skeleton({ className, style, width, height }: { className?: string; style?: CSSProperties; width?: string | number; height?: string | number }) {
  return <span className={cx('st-skeleton', className)} style={{ width, height, ...style }} aria-hidden="true" />
}

export function Icon({
  name,
  label,
  className,
}: {
  name: string
  /** Accessible name. When omitted the icon is aria-hidden. */
  label?: string
  className?: string
}) {
  return (
    <span
      className={cx('st-icon', 'material-symbols-outlined', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name}
    </span>
  )
}

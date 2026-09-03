import Link from 'next/link'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
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

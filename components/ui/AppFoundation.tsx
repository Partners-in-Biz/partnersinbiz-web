import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AppShellProps = ComponentPropsWithoutRef<'div'> & {
  header?: ReactNode
  sidebar?: ReactNode
  children: ReactNode
  contentClassName?: string
  innerClassName?: string
}

export function AppShell({
  header,
  sidebar,
  children,
  className,
  contentClassName,
  innerClassName,
  ...props
}: AppShellProps) {
  return (
    <div className={cn('pib-app-shell', sidebar ? 'md:grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1', className)} {...props}>
      {sidebar ? (
        <aside data-slot="app-shell-sidebar" className="hidden md:block min-h-0 overflow-hidden">
          {sidebar}
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {header ? (
          <div data-slot="app-shell-header" className="shrink-0">
            {header}
          </div>
        ) : null}
        <main data-slot="app-shell-main" className={cn('pib-app-shell-main', contentClassName)}>
          <div data-slot="app-shell-content" className={cn('mx-auto w-full max-w-[1400px]', innerClassName)}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

type PageHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, meta, actions, tabs, className }: PageHeaderProps) {
  return (
    <header className={cn('pib-page-header', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="pib-page-title">{title}</h1>
            {description ? <p className="pib-page-sub">{description}</p> : null}
            {meta ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">{meta}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      {tabs ? <div className="pib-page-header-tabs">{tabs}</div> : null}
    </header>
  )
}

export type PageTab = {
  label: ReactNode
  value: string
  icon?: string
  badge?: ReactNode
  disabled?: boolean
}

type PageTabsProps = {
  tabs: PageTab[]
  value: string
  onValueChange?: (value: string) => void
  ariaLabel?: string
  variant?: 'tabs' | 'segmented'
  className?: string
}

export function PageTabs({ tabs, value, onValueChange, ariaLabel = 'Page tabs', variant = 'tabs', className }: PageTabsProps) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('pib-tabs', variant === 'segmented' && 'pib-tabs-segmented', className)}>
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            className={cn('pib-tab', selected && 'pib-tab-active')}
            onClick={() => {
              if (!tab.disabled) onValueChange?.(tab.value)
            }}
          >
            {tab.icon ? <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{tab.icon}</span> : null}
            <span>{tab.label}</span>
            {tab.badge != null ? <span className="pib-tabs-badge">{tab.badge}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

type ResponsiveHeaderTabsProps = {
  title?: ReactNode
  tabs: ReactNode
  actions?: ReactNode
  className?: string
}

export function ResponsiveHeaderTabs({ title, tabs, actions, className }: ResponsiveHeaderTabsProps) {
  return (
    <div data-slot="responsive-header-tabs" className={cn('pib-responsive-header-tabs', className)}>
      {title ? <div className="min-w-0 text-sm font-medium text-[var(--color-pib-text)]">{title}</div> : null}
      <div className="min-w-0 flex-1 overflow-x-auto">{tabs}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

type SurfaceOwnProps<T extends ElementType> = {
  as?: T
  variant?: 'card' | 'list' | 'table'
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

type SurfaceProps<T extends ElementType> = SurfaceOwnProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>

export function Surface<T extends ElementType = 'section'>({
  as,
  variant = 'card',
  header,
  footer,
  children,
  className,
  bodyClassName,
  ...props
}: SurfaceProps<T>) {
  const Component = as ?? 'section'
  const isPlainCard = variant === 'card' && !header && !footer

  if (isPlainCard) {
    return (
      <Component className={cn('pib-card', className)} {...props}>
        {children}
      </Component>
    )
  }

  return (
    <Component className={cn('pib-surface', `pib-surface-${variant}`, className)} {...props}>
      {header ? <div data-slot="surface-header" className="pib-surface-header">{header}</div> : null}
      <div className={cn('pib-surface-body', bodyClassName)}>{children}</div>
      {footer ? <div data-slot="surface-footer" className="pib-surface-footer">{footer}</div> : null}
    </Component>
  )
}

type EmptyStateProps = {
  icon?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('pib-empty-state', className)}>
      {icon ? <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">{icon}</span> : null}
      <h2 className="pib-empty-state-title">{title}</h2>
      {description ? <p className="pib-empty-state-description">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}

type StatusTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info'

type StatusPillProps = ComponentPropsWithoutRef<'span'> & {
  tone?: StatusTone
  dot?: boolean
}

export function StatusPill({ tone = 'neutral', dot, children, className, ...props }: StatusPillProps) {
  return (
    <span className={cn('pib-pill', tone !== 'neutral' && `pib-pill-${tone}`, className)} {...props}>
      {dot ? <span data-testid="status-dot" className={cn('pib-status-dot', `pib-status-dot-${tone}`)} /> : null}
      {children}
    </span>
  )
}

type DialogDrawerProps = {
  open: boolean
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose?: () => void
  className?: string
}

export function DialogDrawer({ open, title, description, children, footer, onClose, className }: DialogDrawerProps) {
  if (!open) return null

  return (
    <div className="pib-dialog-backdrop">
      <section role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cn('pib-dialog-drawer', className)}>
        <div className="pib-dialog-header">
          <div className="min-w-0">
            <h2 className="pib-dialog-title">{title}</h2>
            {description ? <p className="pib-dialog-description">{description}</p> : null}
          </div>
          {onClose ? (
            <button type="button" aria-label="Close dialog" onClick={onClose} className="pib-dialog-close">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
            </button>
          ) : null}
        </div>
        <div className="pib-dialog-body">{children}</div>
        {footer ? <div className="pib-dialog-footer">{footer}</div> : null}
      </section>
    </div>
  )
}

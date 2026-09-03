import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import Link from 'next/link'
import { Status } from '@/components/studio'
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

export type ModuleAccent = 'amber' | 'accent' | 'violet' | 'rose' | 'blue' | 'green' | 'cyan'

type PageHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
  className?: string
  /**
   * @deprecated Spectral underline retired. Accepted for API compatibility; ignored.
   */
  accent?: ModuleAccent
}

export function PageHeader({ eyebrow, title, description, meta, actions, tabs, className, accent: _accent }: PageHeaderProps) {
  void _accent
  return (
    <header className={cn('pib-page-header', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {eyebrow ? <div className="sc-tiny">{eyebrow}</div> : null}
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="sc-article__h2">{title}</h1>
            {description ? <p className="sc-body">{description}</p> : null}
            {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5 sc-tiny">{meta}</div> : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 [&_.btn-pib-primary]:btn-pib-sm [&_.btn-pib-secondary]:btn-pib-sm [&_.btn-pib-ghost]:btn-pib-sm [&_.pib-btn-primary]:btn-pib-sm [&_.pib-btn-secondary]:btn-pib-sm [&_.st-btn]:st-btn--sm">
              {actions}
            </div>
          ) : null}
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
  /**
   * @deprecated Segmented and underline tabs render identically. Accepted; ignored.
   */
  variant?: 'tabs' | 'segmented'
  className?: string
}

export function PageTabs({ tabs, value, onValueChange, ariaLabel = 'Page tabs', variant: _variant, className }: PageTabsProps) {
  void _variant
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('pib-tabs min-w-0 max-w-full overflow-x-auto', className)}>
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

export type PageLinkTab = PageTab & {
  href: string
  prefetch?: boolean
}

type PageLinkTabsProps = {
  tabs: PageLinkTab[]
  activeValue: string
  ariaLabel?: string
  /**
   * @deprecated Segmented and underline tabs render identically. Accepted; ignored.
   */
  variant?: 'tabs' | 'segmented'
  className?: string
}

export function PageLinkTabs({ tabs, activeValue, ariaLabel = 'Page tabs', variant: _variant, className }: PageLinkTabsProps) {
  void _variant
  return (
    <nav role="tablist" aria-label={ariaLabel} className={cn('pib-tabs min-w-0 max-w-full overflow-x-auto', className)}>
      {tabs.map((tab) => {
        const selected = tab.value === activeValue
        return (
          <Link
            key={tab.value}
            href={tab.href}
            prefetch={tab.prefetch}
            role="tab"
            aria-selected={selected}
            aria-current={selected ? 'page' : undefined}
            className={cn('pib-tab', selected && 'pib-tab-active', tab.disabled && 'pointer-events-none opacity-50')}
          >
            {tab.icon ? <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{tab.icon}</span> : null}
            <span>{tab.label}</span>
            {tab.badge != null ? <span className="pib-tabs-badge">{tab.badge}</span> : null}
          </Link>
        )
      })}
    </nav>
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
      {title ? <div className="min-w-0 sc-body">{title}</div> : null}
      <div className="min-w-0 flex-1 overflow-x-auto">{tabs}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

type SurfaceOwnProps<T extends ElementType> = {
  as?: T
  variant?: 'card' | 'list' | 'table' | 'glass' | 'quiet'
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /**
   * @deprecated Accent edges retired. Accepted for API compatibility; ignored.
   */
  accentEdge?: boolean | ModuleAccent
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
  accentEdge: _accentEdge,
  ...props
}: SurfaceProps<T>) {
  void _accentEdge
  const Component = as ?? 'section'
  const isPlainCard = (variant === 'card' || variant === 'glass' || variant === 'quiet') && !header && !footer
  const flat = variant === 'quiet' || variant === 'glass'
  const panelClass = cn('st-panel', flat && 'st-panel--flat', className)

  if (isPlainCard) {
    return (
      <Component className={panelClass} {...props}>
        {children}
      </Component>
    )
  }

  return (
    <Component className={panelClass} {...props}>
      {header ? <div data-slot="surface-header" className="pib-surface-header">{header}</div> : null}
      <div className={cn('pib-surface-body', bodyClassName)}>{children}</div>
      {footer ? <div data-slot="surface-footer" className="pib-surface-footer">{footer}</div> : null}
    </Component>
  )
}

type EmptyStateProps = {
  /**
   * @deprecated Empty states no longer render icons. Accepted; ignored.
   */
  icon?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  /** Compact is default for Dense Cinematic */
  dense?: boolean
}

export function EmptyState({ icon: _icon, title, description, action, className, dense = true }: EmptyStateProps) {
  void _icon
  return (
    <div className={cn('pib-empty-state', dense && '!py-8', className)}>
      <h2 className="pib-empty-state-title sc-article__h2">{title}</h2>
      {description ? <p className="pib-empty-state-description sc-body">{description}</p> : null}
      {action ? <div className={cn('flex justify-center', dense ? 'mt-3' : 'mt-5')}>{action}</div> : null}
    </div>
  )
}

type StatusTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' | 'violet' | 'blue' | 'cyan' | 'rose'

type StatusPillProps = ComponentPropsWithoutRef<'span'> & {
  tone?: StatusTone
  /**
   * @deprecated Studio Status always shows the status dot via CSS. Accepted; ignored.
   */
  dot?: boolean
}

type StudioStatusTone = 'success' | 'warning' | 'danger' | 'info'

function mapStatusTone(tone: StatusTone): StudioStatusTone | undefined {
  switch (tone) {
    case 'success':
      return 'success'
    case 'warn':
      return 'warning'
    case 'danger':
    case 'rose':
      return 'danger'
    case 'info':
    case 'blue':
    case 'cyan':
      return 'info'
    default:
      return undefined
  }
}

export function StatusPill({ tone = 'neutral', dot: _dot, children, className, ...props }: StatusPillProps) {
  void _dot
  const studioTone = mapStatusTone(tone)
  // Status from the kit owns the visual; forward remaining span attrs on the same node shape.
  if (Object.keys(props).length === 0) {
    return (
      <Status tone={studioTone} className={className}>
        {children}
      </Status>
    )
  }
  return (
    <span
      className={cn('st-status sc-tiny', studioTone && `st-status--${studioTone}`, className)}
      {...props}
    >
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

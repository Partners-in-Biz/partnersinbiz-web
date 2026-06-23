'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type PortalSubnavLink = {
  label: string
  href: string
  icon?: string
  activePatterns?: string[]
}

export type PortalSubnavItem = PortalSubnavLink & {
  children?: PortalSubnavLink[]
}

type PortalSubnavProps = {
  ariaLabel: string
  items: PortalSubnavItem[]
  pathname: string
  className?: string
}

function routePath(href: string): string {
  return href.split('?')[0] ?? href
}

function linkIsActive(link: PortalSubnavLink, pathname: string): boolean {
  const hrefPath = routePath(link.href)
  if (pathname === hrefPath || pathname.startsWith(hrefPath + '/')) return true
  return link.activePatterns?.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/')) ?? false
}

function itemIsActive(item: PortalSubnavItem, pathname: string): boolean {
  if (linkIsActive(item, pathname)) return true
  return item.children?.some((child) => linkIsActive(child, pathname)) ?? false
}

function DropdownItem({ item, pathname }: { item: PortalSubnavItem; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = itemIsActive(item, pathname)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
          active
            ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
            : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04] hover:text-[var(--color-pib-text)]',
        )}
      >
        {item.icon ? <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{item.icon}</span> : null}
        <span>{item.label}</span>
        <span className={cn('material-symbols-outlined text-[16px] transition-transform', open && 'rotate-180')} aria-hidden="true">
          expand_more
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 min-w-[220px] overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] py-1 shadow-2xl"
        >
          {item.children?.map((child) => {
            const childActive = linkIsActive(child, pathname)
            return (
              <Link
                key={child.href}
                href={child.href}
                role="menuitem"
                aria-current={childActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                  childActive
                    ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                    : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04] hover:text-[var(--color-pib-text)]',
                )}
              >
                {child.icon ? <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{child.icon}</span> : null}
                <span>{child.label}</span>
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function DirectItem({ item, pathname }: { item: PortalSubnavItem; pathname: string }) {
  const active = itemIsActive(item, pathname)
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
          : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04] hover:text-[var(--color-pib-text)]',
      )}
    >
      {item.icon ? <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{item.icon}</span> : null}
      <span>{item.label}</span>
    </Link>
  )
}

export function PortalSubnav({ ariaLabel, items, pathname, className }: PortalSubnavProps) {
  if (!items.length) return null

  return (
    <div className={cn('shrink-0 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/95 backdrop-blur-md', className)}>
      <nav aria-label={ariaLabel} className="mx-auto flex min-h-12 w-full max-w-[1400px] flex-wrap items-center gap-1 px-4 py-1.5 md:px-8">
        {items.map((item) => (
          item.children?.length
            ? <DropdownItem key={item.href} item={item} pathname={pathname} />
            : <DirectItem key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
    </div>
  )
}

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
        data-active={active ? 'true' : undefined}
        className="pib-nav-item"
      >
        {item.icon ? (
          <span
            className={cn('material-symbols-outlined text-[16px]', active ? 'text-[var(--color-pib-accent)]' : 'opacity-70')}
            aria-hidden="true"
          >
            {item.icon}
          </span>
        ) : null}
        <span className="font-medium">{item.label}</span>
        <span className={cn('material-symbols-outlined text-[14px] transition-transform', open && 'rotate-180')} aria-hidden="true">
          expand_more
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="fixed left-3 right-3 top-[5.5rem] z-50 mt-0 max-h-[min(60vh,24rem)] overflow-y-auto rounded-xl border border-[var(--color-pib-line)] bg-[var(--pib-fx-glass-strong,var(--color-pib-surface))] py-1 shadow-2xl backdrop-blur-md sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 sm:min-w-[200px]"
        >
          {item.children?.map((child) => {
            const childActive = linkIsActive(child, pathname)
            return (
              <Link
                key={child.href}
                href={child.href}
                role="menuitem"
                aria-current={childActive ? 'page' : undefined}
                data-active={childActive ? 'true' : undefined}
                className="pib-nav-item w-full rounded-none px-3"
              >
                {child.icon ? (
                  <span
                    className={cn('material-symbols-outlined text-[16px]', childActive ? 'text-[var(--color-pib-accent)]' : 'opacity-70')}
                    aria-hidden="true"
                  >
                    {child.icon}
                  </span>
                ) : null}
                <span className="font-medium">{child.label}</span>
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
      data-active={active ? 'true' : undefined}
      className="pib-nav-item shrink-0"
    >
      {item.icon ? (
        <span
          className={cn('material-symbols-outlined text-[16px]', active ? 'text-[var(--color-pib-accent)]' : 'opacity-70')}
          aria-hidden="true"
        >
          {item.icon}
        </span>
      ) : null}
      <span className="font-medium">{item.label}</span>
    </Link>
  )
}

export function PortalSubnav({ ariaLabel, items, pathname, className }: PortalSubnavProps) {
  if (!items.length) return null

  return (
    <div
      className={cn('pib-chrome-sticky sticky top-11 z-40 shrink-0', className)}
    >
      <nav
        aria-label={ariaLabel}
        className="mx-auto flex min-h-9 w-full max-w-[1400px] flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain px-2 py-1 scrollbar-none sm:overflow-visible sm:px-4 md:px-5"
      >
        {items.map((item) =>
          item.children?.length
            ? <DropdownItem key={item.href} item={item} pathname={pathname} />
            : <DirectItem key={item.href} item={item} pathname={pathname} />,
        )}
      </nav>
    </div>
  )
}

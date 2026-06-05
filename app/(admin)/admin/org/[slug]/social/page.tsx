'use client'

import { useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import SocialOverviewWorkspace, { type SocialOverviewAction } from '@/components/social/SocialOverviewWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

function routeParamSlug(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default function OrgSocialIndexPage() {
  const params = useParams<{ slug?: string | string[] }>()
  const slug = routeParamSlug(params?.slug)
  const { selectedOrgId, orgName, orgs } = useOrg()

  const routeOrg = useMemo(
    () => orgs.find((org) => org.slug === slug || org.id === slug),
    [orgs, slug],
  )

  const selectedOrgMatchesRoute = selectedOrgId === routeOrg?.id || selectedOrgId === slug
  const orgId = routeOrg?.id ?? (selectedOrgMatchesRoute ? selectedOrgId : '')
  const resolvedOrgName = routeOrg?.name ?? (selectedOrgMatchesRoute ? orgName : '') ?? ''

  const buildApiPath = useCallback(
    (path: string) => appendQueryParams(path, { orgId }),
    [orgId],
  )

  const scopedAdminHref = useCallback(
    (path: string) => appendQueryParams(path, { org: slug, orgSlug: slug, orgId }),
    [orgId, slug],
  )

  const quickActions = useMemo<SocialOverviewAction[]>(
    () => [
      { label: 'Compose Post', href: scopedAdminHref('/admin/social/compose'), icon: 'edit', primary: true },
      { key: 'inbox', label: 'Inbox', href: scopedAdminHref('/admin/social/inbox'), icon: 'inbox' },
      { label: 'View Queue', href: scopedAdminHref('/admin/social/queue'), icon: 'pending_actions' },
      { label: 'Calendar', href: scopedAdminHref('/admin/social/calendar'), icon: 'calendar_month' },
      { label: 'Campaigns', href: `/admin/org/${encodeURIComponent(slug)}/campaigns`, icon: 'flag' },
      { label: 'Standalone', href: scopedAdminHref('/admin/social/standalone'), icon: 'edit_note' },
      { label: 'Accounts', href: scopedAdminHref('/admin/social/accounts'), icon: 'hub' },
      { label: 'Links', href: scopedAdminHref('/admin/social/links'), icon: 'link' },
    ],
    [scopedAdminHref, slug],
  )

  const primaryAction = useMemo<SocialOverviewAction>(
    () => ({
      label: 'Compose post',
      href: scopedAdminHref('/admin/social/compose'),
      icon: 'edit_square',
    }),
    [scopedAdminHref],
  )

  return (
    <OrgThemedFrame orgId={orgId || null} className="-m-6 min-h-screen p-6">
      {!orgId ? (
        <div className="mx-auto max-w-7xl space-y-6 text-[var(--color-pib-text)]">
          <header>
            <p className="eyebrow">Workspace / Social</p>
            <h1 className="pib-page-title mt-2">Loading client social</h1>
            <p className="pib-page-sub mt-2">
              Resolving the selected organisation before loading social accounts and posts.
            </p>
          </header>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="pib-skeleton h-28" />
            ))}
          </section>
        </div>
      ) : (
        <SocialOverviewWorkspace
          surface="admin"
          eyebrow="Workspace / Social"
          title={`${resolvedOrgName || 'Client'} social`}
          description={`Monitor posts, account health, approvals, and publishing activity for ${resolvedOrgName || 'this client'}.`}
          postsLimit={200}
          buildApiPath={buildApiPath}
          primaryAction={primaryAction}
          quickActions={quickActions}
          showInboxCount
          showRecentPosts
        />
      )}
    </OrgThemedFrame>
  )
}

import { HubPage } from '@/components/navigation/HubPage'

export const dynamic = 'force-dynamic'

export default function PortalMarketingPage() {
  return (
    <HubPage
      eyebrow="Client portal"
      title="Marketing"
      description="Your brand, campaigns, social approvals, SEO work, contacts, and lead capture in one place."
      primaryAction={{
        label: 'Review social',
        href: '/portal/social',
        icon: 'rate_review',
        description: 'Review social work.',
      }}
      sections={[
        {
          title: 'Brand and campaigns',
          actions: [
            {
              label: 'Branding',
              href: '/portal/branding',
              icon: 'palette',
              description: 'Review brand assets, colours, voice, and profile information.',
              eyebrow: 'Brand',
            },
            {
              label: 'Campaigns',
              href: '/portal/campaigns',
              icon: 'flag',
              description: 'See content campaigns, email campaigns, broadcasts, and work in progress.',
              eyebrow: 'Content',
            },
            {
              label: 'Ads',
              href: '/portal/ads',
              icon: 'ads_click',
              description: 'Review paid campaigns, approvals, and campaign activity.',
              eyebrow: 'Paid',
            },
            {
              label: 'SEO',
              href: '/portal/seo',
              icon: 'trending_up',
              description: 'Track sprint progress, keywords, content, audits, pages, and blog drafts.',
              eyebrow: 'Search',
            },
          ],
        },
        {
          title: 'Social media',
          actions: [
            {
              label: 'Social overview',
              href: '/portal/social',
              icon: 'share',
              description: 'Approve posts, review history, and see social publishing status.',
              eyebrow: 'Review',
            },
            {
              label: 'Compose',
              href: '/portal/social/compose',
              icon: 'edit_square',
              description: 'Create a social post for review or publishing.',
              eyebrow: 'Create',
            },
            {
              label: 'Calendar',
              href: '/portal/social/calendar',
              icon: 'calendar_month',
              description: 'See scheduled and planned posts across your social channels.',
              eyebrow: 'Schedule',
            },
            {
              label: 'History',
              href: '/portal/social/history',
              icon: 'history',
              description: 'Review scheduled, published, failed, draft, and cancelled social posts.',
              eyebrow: 'Archive',
            },
            {
              label: 'Vault',
              href: '/portal/social/vault',
              icon: 'folder_special',
              description: 'Download or reuse approved social assets.',
              eyebrow: 'Assets',
            },
            {
              label: 'Accounts',
              href: '/portal/social/accounts',
              icon: 'hub',
              description: 'Connect and inspect your social channels.',
              eyebrow: 'Connect',
            },
            {
              label: 'Links',
              href: '/portal/social/links',
              icon: 'link',
              description: 'Manage links used in profiles and campaigns.',
              eyebrow: 'Profile',
            },
          ],
        },
        {
          title: 'Audience and setup',
          actions: [
            {
              label: 'Contacts',
              href: '/portal/contacts',
              icon: 'contacts',
              description: 'View contacts and audience records.',
              eyebrow: 'Audience',
            },
            {
              label: 'Email analytics',
              href: '/portal/email-analytics',
              icon: 'query_stats',
              description: 'Track email delivery, opens, clicks, and engagement performance.',
              eyebrow: 'Reporting',
            },
            {
              label: 'Capture sources',
              href: '/portal/capture-sources',
              icon: 'inventory_2',
              description: 'Manage lead forms, imports, and capture surfaces.',
              eyebrow: 'Leads',
            },
            {
              label: 'Integrations',
              href: '/portal/integrations',
              icon: 'extension',
              description: 'Review connected systems and marketing integrations.',
              eyebrow: 'Systems',
            },
            {
              label: 'Email domains',
              href: '/portal/email-domains',
              icon: 'dns',
              description: 'Check sender-domain verification and deliverability setup.',
              eyebrow: 'Email',
            },
          ],
        },
      ]}
    />
  )
}

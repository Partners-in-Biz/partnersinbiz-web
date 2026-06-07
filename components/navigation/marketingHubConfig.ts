import type { HubAction, HubPageProps, HubSection } from './HubPage'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

type MarketingHubSurface =
  | { surface: 'portal'; orgId?: string; orgSlug?: string; sourceCompanyId?: string; sourceCompanyName?: string }
  | { surface: 'admin' }
  | { surface: 'admin-org'; slug: string }

function orgPath(slug: string, path: string) {
  return `/admin/org/${encodeURIComponent(slug)}${path}`
}

function orgQueryPath(slug: string, path: string) {
  return `${path}${path.includes('?') ? '&' : '?'}org=${encodeURIComponent(slug)}`
}

function section(title: string, actions: HubAction[]): HubSection {
  return { title, actions }
}

export function buildMarketingHubProps(config: MarketingHubSurface): HubPageProps {
  if (config.surface === 'portal') {
    return {
      eyebrow: 'Client portal',
      title: 'Marketing',
      description: 'Your brand, campaigns, social approvals, SEO work, contacts, and lead capture in one place.',
      sourceContext: config.sourceCompanyName
        ? { sourceCompanyName: config.sourceCompanyName, targetWorkspaceName: config.orgSlug || config.orgId || 'the linked organisation' }
        : undefined,
      primaryAction: {
        label: 'Review social',
        href: scopedPortalPath('/portal/social', config),
        icon: 'rate_review',
        description: 'Review social work.',
      },
      sections: [
        section('Brand and campaigns', [
          {
            label: 'Branding',
            href: scopedPortalPath('/portal/branding', config),
            icon: 'palette',
            description: 'Review brand assets, colours, voice, and profile information.',
            eyebrow: 'Brand',
          },
          {
            label: 'Campaigns',
            href: scopedPortalPath('/portal/campaigns', config),
            icon: 'flag',
            description: 'See content campaigns, email campaigns, broadcasts, and work in progress.',
            eyebrow: 'Content',
          },
          {
            label: 'Ads',
            href: scopedPortalPath('/portal/ads', config),
            icon: 'ads_click',
            description: 'Review paid campaigns, approvals, and campaign activity.',
            eyebrow: 'Paid',
          },
          {
            label: 'SEO',
            href: scopedPortalPath('/portal/seo', config),
            icon: 'trending_up',
            description: 'Track sprint progress, keywords, content, audits, pages, and blog drafts.',
            eyebrow: 'Search',
          },
          {
            label: 'GEO SEO',
            href: scopedPortalPath('/portal/geo-seo', config),
            icon: 'psychology_alt',
            description: 'Review AI search visibility, GEO audits, answer-engine readiness, and approval-gated reports.',
            eyebrow: 'AI search',
          },
        ]),
        section('Social media', [
          {
            label: 'Social overview',
            href: scopedPortalPath('/portal/social', config),
            icon: 'share',
            description: 'Approve posts, review history, and see social publishing status.',
            eyebrow: 'Review',
          },
          {
            label: 'Compose',
            href: scopedPortalPath('/portal/social/compose', config),
            icon: 'edit_square',
            description: 'Create a social post for review or publishing.',
            eyebrow: 'Create',
          },
          {
            label: 'Calendar',
            href: scopedPortalPath('/portal/social/calendar', config),
            icon: 'calendar_month',
            description: 'See scheduled and planned posts across your social channels.',
            eyebrow: 'Schedule',
          },
          {
            label: 'History',
            href: scopedPortalPath('/portal/social/history', config),
            icon: 'history',
            description: 'Review scheduled, published, failed, draft, and cancelled social posts.',
            eyebrow: 'Archive',
          },
          {
            label: 'Vault',
            href: scopedPortalPath('/portal/social/vault', config),
            icon: 'folder_special',
            description: 'Download or reuse approved social assets.',
            eyebrow: 'Assets',
          },
          {
            label: 'Accounts',
            href: scopedPortalPath('/portal/social/accounts', config),
            icon: 'hub',
            description: 'Connect and inspect your social channels.',
            eyebrow: 'Connect',
          },
          {
            label: 'Links',
            href: scopedPortalPath('/portal/social/links', config),
            icon: 'link',
            description: 'Manage links used in profiles and campaigns.',
            eyebrow: 'Profile',
          },
        ]),
        section('Email and capture', [
          {
            label: 'Sequences',
            href: scopedPortalPath('/portal/settings/sequences', config),
            icon: 'route',
            description: 'Build multi-step email nurture paths for captured contacts and clients.',
            eyebrow: 'Journey',
          },
          {
            label: 'Automations',
            href: scopedPortalPath('/portal/settings/automations', config),
            icon: 'bolt',
            description: 'Trigger follow-up actions from CRM events, tags, forms, and sequence activity.',
            eyebrow: 'Rules',
          },
          {
            label: 'Email analytics',
            href: scopedPortalPath('/portal/email-analytics', config),
            icon: 'query_stats',
            description: 'Track email delivery, opens, clicks, and engagement performance.',
            eyebrow: 'Reporting',
          },
          {
            label: 'Capture sources',
            href: scopedPortalPath('/portal/capture-sources', config),
            icon: 'inventory_2',
            description: 'Manage lead forms, imports, and capture surfaces.',
            eyebrow: 'Leads',
          },
          {
            label: 'Email domains',
            href: scopedPortalPath('/portal/email-domains', config),
            icon: 'dns',
            description: 'Check sender-domain verification and deliverability setup.',
            eyebrow: 'Email',
          },
        ]),
        section('Audience and setup', [
          {
            label: 'Contacts',
            href: scopedPortalPath('/portal/contacts', config),
            icon: 'contacts',
            description: 'View contacts and audience records.',
            eyebrow: 'Audience',
          },
          {
            label: 'Communications',
            href: scopedPortalPath('/portal/communications', config),
            icon: 'forum',
            description: 'Manage customer conversations, campaign replies, templates, and channel performance.',
            eyebrow: 'Comms',
          },
          {
            label: 'Integrations',
            href: scopedPortalPath('/portal/integrations', config),
            icon: 'extension',
            description: 'Review connected systems and marketing integrations.',
            eyebrow: 'Systems',
          },
        ]),
      ],
    }
  }

  if (config.surface === 'admin-org') {
    const { slug } = config

    return {
      eyebrow: 'Client workspace',
      title: 'Marketing',
      description: 'Brand, campaign, social, email, SEO, and lead-capture work for this client.',
      primaryAction: {
        label: 'Compose post',
        href: orgQueryPath(slug, '/admin/social/compose'),
        icon: 'edit_square',
        description: 'Create a social post.',
      },
      sections: [
        section('Brand and campaigns', [
          {
            label: 'Branding',
            href: orgPath(slug, '/brand'),
            icon: 'palette',
            description: 'Manage logo assets, voice, colours, handles, and brand direction.',
            eyebrow: 'Brand',
          },
          {
            label: 'Campaigns',
            href: orgPath(slug, '/campaigns'),
            icon: 'flag',
            description: 'Open the client campaign workspace and production pipeline.',
            eyebrow: 'Content',
          },
          {
            label: 'Ads',
            href: orgPath(slug, '/ads/campaigns'),
            icon: 'ads_click',
            description: 'Build, review, and monitor paid campaigns for this client.',
            eyebrow: 'Paid',
          },
          {
            label: 'SEO',
            href: orgPath(slug, '/seo'),
            icon: 'trending_up',
            description: 'Create or open the client SEO sprint.',
            eyebrow: 'Search',
          },
        ]),
        section('Social media', [
          {
            label: 'Social overview',
            href: orgPath(slug, '/social'),
            icon: 'share',
            description: 'Review client social status and publishing health.',
            eyebrow: 'Review',
          },
          {
            label: 'Compose',
            href: orgQueryPath(slug, '/admin/social/compose'),
            icon: 'edit_square',
            description: 'Draft and schedule posts for connected platforms.',
            eyebrow: 'Create',
          },
          {
            label: 'Calendar',
            href: orgQueryPath(slug, '/admin/social/calendar'),
            icon: 'calendar_month',
            description: 'See scheduled and planned posts across channels.',
            eyebrow: 'Schedule',
          },
          {
            label: 'History',
            href: orgQueryPath(slug, '/admin/social/history'),
            icon: 'history',
            description: 'Review published, failed, and cancelled social posts.',
            eyebrow: 'Archive',
          },
          {
            label: 'Queue',
            href: orgQueryPath(slug, '/admin/social/queue'),
            icon: 'pending_actions',
            description: 'Work through publishing, approval, and retry queues.',
            eyebrow: 'Ops',
          },
          {
            label: 'Accounts',
            href: orgQueryPath(slug, '/admin/social/accounts'),
            icon: 'hub',
            description: 'Connect and troubleshoot social accounts.',
            eyebrow: 'Connect',
          },
          {
            label: 'Links',
            href: orgQueryPath(slug, '/admin/social/links'),
            icon: 'link',
            description: 'Manage link-in-bio and campaign link surfaces.',
            eyebrow: 'Profile',
          },
        ]),
        section('Email and capture', [
          {
            label: 'Email',
            href: orgQueryPath(slug, '/admin/email'),
            icon: 'mail',
            description: 'Manage client email drafts, scheduled sends, broadcasts, and failures.',
            eyebrow: 'Comms',
          },
          {
            label: 'Email analytics',
            href: orgQueryPath(slug, '/admin/email-analytics'),
            icon: 'query_stats',
            description: 'Review email delivery, opens, clicks, and source performance.',
            eyebrow: 'Reporting',
          },
          {
            label: 'Sequences',
            href: orgQueryPath(slug, '/admin/sequences'),
            icon: 'route',
            description: 'Maintain client nurture journeys.',
            eyebrow: 'Journey',
          },
          {
            label: 'Capture sources',
            href: orgPath(slug, '/capture-sources'),
            icon: 'inventory_2',
            description: 'Manage forms, imports, and lead capture surfaces.',
            eyebrow: 'Leads',
          },
          {
            label: 'Email domains',
            href: orgPath(slug, '/email-domains'),
            icon: 'dns',
            description: 'Check sender domains and verification state.',
            eyebrow: 'Email',
          },
        ]),
        section('Audience and setup', [
          {
            label: 'Contacts',
            href: orgQueryPath(slug, '/admin/crm/contacts'),
            icon: 'contacts',
            description: 'Manage leads, prospects, clients, tags, and lifecycle stages.',
            eyebrow: 'Audience',
          },
          {
            label: 'Communications',
            href: orgQueryPath(slug, '/admin/communications'),
            icon: 'forum',
            description: 'Manage conversations, campaign replies, templates, queues, and channel health.',
            eyebrow: 'Comms',
          },
          {
            label: 'Integrations',
            href: orgPath(slug, '/integrations'),
            icon: 'extension',
            description: 'Connect CRMs, analytics, and external systems for this client.',
            eyebrow: 'Systems',
          },
        ]),
      ],
    }
  }

  return {
    eyebrow: 'Admin hub',
    title: 'Marketing',
    description: 'Plan, publish, review, and improve client growth work from one command surface.',
    primaryAction: {
      label: 'Compose post',
      href: '/admin/social/compose',
      icon: 'edit_square',
      description: 'Create a social post.',
    },
    sections: [
      section('Campaign work', [
        {
          label: 'Campaigns',
          href: '/admin/campaigns',
          icon: 'flag',
          description: 'Build and manage multi-asset client campaigns.',
          eyebrow: 'Content',
        },
        {
          label: 'Social media',
          href: '/admin/social',
          icon: 'campaign',
          description: 'Review queues, calendars, approvals, inboxes, accounts, and social links.',
          eyebrow: 'Publishing',
        },
        {
          label: 'SEO',
          href: '/admin/seo',
          icon: 'trending_up',
          description: 'Run sprints, draft content, monitor keywords, and track optimisation work.',
          eyebrow: 'Search',
        },
      ]),
      section('Email and nurture', [
        {
          label: 'Communications',
          href: '/admin/communications',
          icon: 'forum',
          description: 'Manage WhatsApp, SMS, email, in-app, Messenger, and Instagram conversations and campaigns.',
          eyebrow: 'Omnichannel',
        },
        {
          label: 'Email',
          href: '/admin/email',
          icon: 'mail',
          description: 'Manage broadcasts, drafts, scheduled sends, failed sends, and inbound mail.',
          eyebrow: 'Comms',
        },
        {
          label: 'Sequences',
          href: '/admin/sequences',
          icon: 'stacked_email',
          description: 'Create and maintain automated nurture journeys.',
          eyebrow: 'Automation',
        },
        {
          label: 'Email templates',
          href: '/admin/email-templates',
          icon: 'view_quilt',
          description: 'Maintain reusable email layouts and campaign blocks.',
          eyebrow: 'Assets',
        },
      ]),
      section('Growth inputs', [
        {
          label: 'Lead capture',
          href: '/admin/capture-sources',
          icon: 'inventory_2',
          description: 'Manage forms, embeds, imports, and capture source performance.',
          eyebrow: 'Leads',
        },
        {
          label: 'Social design',
          href: '/admin/social/design',
          icon: 'palette',
          description: 'Open design tools and creative assets used for social publishing.',
          eyebrow: 'Brand',
        },
        {
          label: 'Social accounts',
          href: '/admin/social/accounts',
          icon: 'hub',
          description: 'Connect and inspect client social platform accounts.',
          eyebrow: 'OAuth',
        },
      ]),
    ],
  }
}

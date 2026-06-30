import type { HubAction, HubPageProps, HubSection } from './HubPage'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

type MarketingHubSurface =
  | { surface: 'portal'; orgId?: string; orgSlug?: string; sourceCompanyId?: string; sourceCompanyName?: string }
  | { surface: 'admin' }
  | { surface: 'admin-org'; slug: string }

function orgPath(slug: string, path: string) {
  return `/admin/org/${encodeURIComponent(slug)}${path}`
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
        section('Personal workspace', [
          {
            label: 'Personal marketing',
            href: '/portal/personal/marketing',
            icon: 'person',
            description: 'Your own social accounts, drafts, and X MCP/bookmark access. Separate from this company workspace.',
            eyebrow: 'User-owned',
          },
          {
            label: 'Personal accounts',
            href: '/portal/personal/social/accounts',
            icon: 'person_add',
            description: 'Connect social accounts and personal X MCP under your user profile, not the organisation.',
            eyebrow: 'Connect',
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
      eyebrow: 'Workspace / Marketing',
      title: 'Marketing governance',
      description: 'Control which marketing modules this organisation can use, who can create work, who can approve or publish, and which child workspaces hold the detailed settings for each channel.',
      primaryAction: {
        label: 'Open module settings',
        href: orgPath(slug, '/settings'),
        icon: 'admin_panel_settings',
        description: 'Review organisation-level portal module switches and access defaults.',
      },
      sections: [
        section('Module access and creation rights', [
          {
            label: 'Brand governance',
            href: orgPath(slug, '/brand'),
            icon: 'palette',
            description: 'Set who can manage brand assets, voice, colours, handles, and brand direction for this organisation.',
            eyebrow: 'Access',
          },
          {
            label: 'Campaign permissions',
            href: orgPath(slug, '/campaigns'),
            icon: 'flag',
            description: 'Set who can create campaigns, request campaign work, approve content, and archive campaign records.',
            eyebrow: 'Content',
          },
          {
            label: 'Paid media permissions',
            href: orgPath(slug, '/ads/campaigns'),
            icon: 'ads_click',
            description: 'Set who can create ads, manage budgets, approve launches, and connect paid-media accounts.',
            eyebrow: 'Paid',
          },
          {
            label: 'SEO permissions',
            href: orgPath(slug, '/seo'),
            icon: 'trending_up',
            description: 'Set who can create SEO sprints, approve content, manage audits, and publish search work.',
            eyebrow: 'Search',
          },
          {
            label: 'GEO SEO permissions',
            href: orgPath(slug, '/geo-seo'),
            icon: 'psychology_alt',
            description: 'Set who can run AI-search audits, approve gated reports, and manage answer-engine visibility work.',
            eyebrow: 'AI search',
          },
        ]),
        section('Social publishing controls', [
          {
            label: 'Social visibility',
            href: orgPath(slug, '/social'),
            icon: 'share',
            description: 'Set who can see social work, queues, calendars, account health, and publishing status.',
            eyebrow: 'Portal',
          },
          {
            label: 'Post creation',
            href: orgPath(slug, '/social/standalone'),
            icon: 'edit_square',
            description: 'Set who can draft posts, request content, use AI generation, and attach campaign assets.',
            eyebrow: 'Create',
          },
          {
            label: 'Scheduling rules',
            href: orgPath(slug, '/social'),
            icon: 'calendar_month',
            description: 'Set who can schedule, reschedule, cancel, or move posts across the publishing calendar.',
            eyebrow: 'Schedule',
          },
          {
            label: 'History and archive',
            href: orgPath(slug, '/social'),
            icon: 'history',
            description: 'Set who can review history, restore drafts, archive posts, and inspect failures.',
            eyebrow: 'Archive',
          },
          {
            label: 'Approval queues',
            href: orgPath(slug, '/social'),
            icon: 'pending_actions',
            description: 'Set who can approve, reject, retry, or publish work from social production queues.',
            eyebrow: 'Approval',
          },
          {
            label: 'Account connections',
            href: orgPath(slug, '/social'),
            icon: 'hub',
            description: 'Set who can connect, disconnect, troubleshoot, and choose default social accounts.',
            eyebrow: 'Connect',
          },
          {
            label: 'Profile links',
            href: orgPath(slug, '/social'),
            icon: 'link',
            description: 'Set who can manage link-in-bio, profile links, campaign URLs, and tracking links.',
            eyebrow: 'Profile',
          },
        ]),
        section('Email and capture controls', [
          {
            label: 'Email permissions',
            href: orgPath(slug, '/messages'),
            icon: 'mail',
            description: 'Set who can create email drafts, approve broadcasts, schedule sends, and inspect failures.',
            eyebrow: 'Comms',
          },
          {
            label: 'Email analytics access',
            href: orgPath(slug, '/messages'),
            icon: 'query_stats',
            description: 'Set who can view delivery, opens, clicks, source performance, and engagement reports.',
            eyebrow: 'Reporting',
          },
          {
            label: 'Sequence rules',
            href: orgPath(slug, '/capture-sources'),
            icon: 'route',
            description: 'Set who can create, edit, activate, pause, or delete nurture journeys and follow-up rules.',
            eyebrow: 'Journey',
          },
          {
            label: 'Capture source access',
            href: orgPath(slug, '/capture-sources'),
            icon: 'inventory_2',
            description: 'Set who can create forms, imports, landing captures, lead sources, and routing rules.',
            eyebrow: 'Leads',
          },
          {
            label: 'Sender-domain control',
            href: orgPath(slug, '/email-domains'),
            icon: 'dns',
            description: 'Set who can manage sender domains, DNS checks, verification, and deliverability setup.',
            eyebrow: 'Email',
          },
        ]),
        section('Audience and systems controls', [
          {
            label: 'Audience access',
            href: orgPath(slug, '/capture-sources'),
            icon: 'contacts',
            description: 'Set who can view contacts, edit audience records, manage tags, and change lifecycle stages.',
            eyebrow: 'Audience',
          },
          {
            label: 'Communications control',
            href: orgPath(slug, '/messages'),
            icon: 'forum',
            description: 'Set who can manage conversations, campaign replies, templates, queues, and channel health.',
            eyebrow: 'Comms',
          },
          {
            label: 'Marketing integrations',
            href: orgPath(slug, '/integrations'),
            icon: 'extension',
            description: 'Set who can connect CRMs, analytics, ad platforms, email systems, and external marketing tools.',
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
      href: '/portal/social/compose',
      icon: 'edit_square',
      description: 'Create a social post.',
    },
    sections: [
      section('Campaign work', [
        {
          label: 'Campaigns',
          href: '/portal/campaigns',
          icon: 'flag',
          description: 'Build and manage multi-asset client campaigns.',
          eyebrow: 'Content',
        },
        {
          label: 'Social media',
          href: '/portal/social',
          icon: 'campaign',
          description: 'Review queues, calendars, approvals, inboxes, accounts, and social links.',
          eyebrow: 'Publishing',
        },
        {
          label: 'SEO',
          href: '/portal/seo',
          icon: 'trending_up',
          description: 'Run sprints, draft content, monitor keywords, and track optimisation work.',
          eyebrow: 'Search',
        },
        {
          label: 'GEO SEO',
          href: '/portal/geo-seo',
          icon: 'psychology_alt',
          description: 'Run AI search visibility workspaces, GEO audits, and approval-gated reports.',
          eyebrow: 'AI search',
        },
      ]),
      section('Email and nurture', [
        {
          label: 'Communications',
          href: '/portal/communications',
          icon: 'forum',
          description: 'Manage WhatsApp, SMS, email, in-app, Messenger, and Instagram conversations and campaigns.',
          eyebrow: 'Omnichannel',
        },
        {
          label: 'Email',
          href: '/portal/email',
          icon: 'mail',
          description: 'Manage broadcasts, drafts, scheduled sends, failed sends, and inbound mail.',
          eyebrow: 'Comms',
        },
        {
          label: 'Sequences',
          href: '/portal/sequences',
          icon: 'stacked_email',
          description: 'Create and maintain automated nurture journeys.',
          eyebrow: 'Automation',
        },
        {
          label: 'Email templates',
          href: '/portal/email-templates',
          icon: 'view_quilt',
          description: 'Maintain reusable email layouts and campaign blocks.',
          eyebrow: 'Assets',
        },
      ]),
      section('Growth inputs', [
        {
          label: 'Lead capture',
          href: '/portal/capture-sources',
          icon: 'inventory_2',
          description: 'Manage forms, embeds, imports, and capture source performance.',
          eyebrow: 'Leads',
        },
        {
          label: 'Social design',
          href: '/portal/social/design',
          icon: 'palette',
          description: 'Open design tools and creative assets used for social publishing.',
          eyebrow: 'Brand',
        },
        {
          label: 'Social accounts',
          href: '/portal/social/accounts',
          icon: 'hub',
          description: 'Connect and inspect client social platform accounts.',
          eyebrow: 'OAuth',
        },
      ]),
    ],
  }
}

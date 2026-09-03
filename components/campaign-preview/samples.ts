import type { PreviewSocialPost, PreviewBlog, PreviewBrand } from './types'

const STOCK_IMAGE =
  'https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80&auto=format&fit=crop'
const STOCK_IMAGE_2 =
  'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200&q=80&auto=format&fit=crop'
const STOCK_VIDEO_THUMB =
  'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1200&q=80&auto=format&fit=crop'
const STOCK_VIDEO_URL =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
const STOCK_AVATAR =
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&q=80&auto=format&fit=crop'

export const sampleBrand: PreviewBrand = {
  palette: {
    bg: 'var(--sc-ink)',
    accent: 'var(--sc-accent)',
    alert: '#FF5A5F',
    text: '#EDEDED',
    muted: '#8B8B92',
  },
  typography: {
    heading: 'Instrument Serif, "Times New Roman", serif',
    body: 'Geist, system-ui, sans-serif',
  },
  logoUrl: STOCK_AVATAR,
}

export const sampleInstagramFeed: PreviewSocialPost = {
  id: 'sample-ig-feed-1',
  platform: 'instagram',
  content:
    'Three small habits that quietly compound into massive growth  -  drop your favourite in the comments below 👇',
  hashtags: ['founders', 'growth', 'startup'],
  authorHandle: 'partnersinbiz',
  authorName: 'Partners in Biz',
  authorAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  status: 'scheduled',
  media: [{ type: 'image', url: STOCK_IMAGE, alt: 'Three small habits' }],
  likeCount: 1284,
  commentCount: 42,
}

export const sampleInstagramReel: PreviewSocialPost = {
  id: 'sample-ig-reel-1',
  platform: 'instagram',
  content:
    'POV: you stopped chasing leads and started building an audience. Watch what happens in 90 days. ⤴',
  hashtags: ['founders', 'audiencefirst'],
  authorHandle: 'partnersinbiz',
  authorAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date().toISOString(),
  status: 'scheduled',
  media: [
    {
      type: 'video',
      url: STOCK_VIDEO_URL,
      urlStories: STOCK_VIDEO_URL,
      thumbnailUrl: STOCK_VIDEO_THUMB,
      durationSec: 32,
    },
  ],
  likeCount: 12300,
  commentCount: 184,
  shareCount: 64,
}

export const sampleInstagramStory: PreviewSocialPost = {
  id: 'sample-ig-story-1',
  platform: 'instagram',
  content: 'New blog drop today.',
  authorHandle: 'partnersinbiz',
  authorAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date(Date.now() - 60 * 1000).toISOString(),
  status: 'scheduled',
  media: [{ type: 'image', url: STOCK_IMAGE_2, alt: 'New blog drop today' }],
}

export const sampleFacebookPost: PreviewSocialPost = {
  id: 'sample-fb-1',
  platform: 'facebook',
  content:
    "We just shipped the new client cockpit  -  generate a full 90-day campaign in under a minute. Here's what's inside 👇",
  hashtags: ['ProductUpdate'],
  authorName: 'Partners in Biz',
  authorAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  status: 'scheduled',
  media: [{ type: 'image', url: STOCK_IMAGE, alt: 'New client cockpit' }],
  likeCount: 248,
  commentCount: 32,
  shareCount: 12,
}

export const sampleLinkedInPost: PreviewSocialPost = {
  id: 'sample-li-1',
  platform: 'linkedin',
  content: `I used to think marketing meant ads.

Three years and a thousand experiments later, here's what actually moved the needle:

→ One useful piece of content per week, every week
→ A proper CRM and a follow-up cadence (not a spreadsheet that everyone ignores)
→ Showing the work in public, even when it's messy

The compounding is brutal at first. Then magical.`,
  hashtags: ['marketing', 'founders', 'growth'],
  authorName: 'Peet Stander',
  authorHeadline: 'Founder, Partners in Biz · Helping service businesses scale with AI',
  authorAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  status: 'scheduled',
  media: [{ type: 'image', url: STOCK_IMAGE, alt: 'Three years of marketing' }],
  likeCount: 184,
  commentCount: 24,
  shareCount: 8,
}

export const sampleTwitterPost: PreviewSocialPost = {
  id: 'sample-tw-1',
  platform: 'twitter',
  content: 'Most "growth hacks" are noise. Here are the three that actually compound:',
  thread: [
    'Most "growth hacks" are noise. Here are the three that actually compound:',
    'Ship one useful thing per week. Public. Same day. Same channel. The compounding only starts when you remove the question of *if* you\'ll publish.',
    'Have a CRM. Not a spreadsheet. Not your inbox. A CRM. Every conversation logged, every follow-up scheduled. Boring wins.',
    "Build in public. The audience you accidentally pick up by working out loud is worth more than any ad spend you'll ever make.",
  ],
  hashtags: ['buildinpublic'],
  authorName: 'Peet Stander',
  authorHandle: 'peetstander',
  authorAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  status: 'scheduled',
  likeCount: 432,
  commentCount: 28,
  shareCount: 96,
  viewCount: 18400,
}

export const sampleYouTubePost: PreviewSocialPost = {
  id: 'sample-yt-1',
  platform: 'youtube',
  content: 'How we generated 90 days of campaigns in under a minute.',
  videoTitle: 'How we generated 90 days of campaigns in under a minute',
  channelName: 'Partners in Biz',
  channelAvatarUrl: STOCK_AVATAR,
  scheduledFor: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'scheduled',
  viewCount: 12400,
  media: [
    {
      type: 'video',
      url: STOCK_VIDEO_URL,
      urlYoutube: STOCK_VIDEO_URL,
      thumbnailUrl: STOCK_VIDEO_THUMB,
      durationSec: 482,
    },
  ],
}

export const sampleBlog: PreviewBlog = {
  id: 'sample-blog-1',
  title: 'The audience-first playbook for service businesses in 2026',
  type: 'blog',
  publishDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  targetUrl: 'https://partnersinbiz.online/blog/audience-first-playbook',
  status: 'draft',
  authorName: 'Peet Stander',
  authorAvatarUrl: STOCK_AVATAR,
  heroImageUrl: STOCK_IMAGE,
  readTimeMinutes: 6,
  draft: {
    metaDescription:
      'A practical, no-fluff playbook for service businesses who want to grow without burning cash on ads.',
    wordCount: 1320,
    body: `If you run a service business in 2026, the old playbook is broken.

Cold email is dying. Paid ads are getting more expensive every quarter. SEO is harder than it's ever been. And yet, somehow, the businesses that are growing fastest aren't doing any of those things particularly well.

## What they're doing instead

They're building an audience first.

That's it. That's the whole insight. But the implementation is where it gets interesting.

### The three habits

- **Publish weekly, no exceptions.** Same channel, same day, same format. Boring on purpose.
- **Talk to one customer every week.** Record it. Use it as the source material for next week's content.
- **Pick a fight worth picking.** Have an opinion. Defend it.

### Why this works

Most of your competitors are still running the old playbook. They're spending more on ads while their conversion rates drop. They're chasing SEO traffic that converts at 0.4%.

Meanwhile, you're building a list of people who *trust you*. Who open your emails. Who read your essays. Who, when they have the problem you solve, don't even shop around  -  they just hire you.

> The compounding is brutal at first. Then magical.

## What to do this week

1. Pick one channel. LinkedIn or YouTube  -  those are where service-business audiences live.
2. Commit to one piece of content per week, for 90 days.
3. After 90 days, look at the data. Adjust.

That's the whole thing. [Start your 90-day plan here](https://partnersinbiz.online).`,
  },
}

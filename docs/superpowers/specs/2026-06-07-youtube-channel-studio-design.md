# YouTube Channel Studio Design Spec

**Status:** approved product direction, written spec for review.
**Date:** 2026-06-07.
**Owner:** Pip.
**Product area:** Partners in Biz admin, client portal, Hermes skills, video production, YouTube publishing, analytics.

## Purpose

Partners in Biz needs a module for creating, managing, publishing, and improving YouTube channels with AI-assisted production. The module should cover everything from raw footage clipping to full video planning, scripting, packaging, publishing readiness, and analytics feedback.

This should not start as a generic "AI video generator" or full browser-based editor. It should be a PiB-native production cockpit: a controlled operating system for YouTube channel work across PiB operators, Hermes agents, and client reviewers.

The approved V1 direction is **YouTube Channel Studio: Production Cockpit**.

V1 is internal-production first:

- PiB admins and Hermes agents run production.
- Clients can request work, upload footage, comment, approve, reject, and view results through the portal when the module is enabled.
- Public publishing stays behind a PiB admin gate.
- Automation creates bounded artifacts and readiness checks, not unchecked public uploads.

## Current Evidence

### PiB Platform Context

The app already has strong primitives that should be reused:

- **Portal module switches:** client-visible features can be enabled per organisation through `settings.portalModules`.
- **Shared admin/portal workspaces:** recent Campaigns, Social, Documents, CRM, Ads, Projects, and Mobile Apps work favours one shared workspace component with route-specific wrappers.
- **Research:** source-backed discovery, competitor analysis, video topic research, and recommendations.
- **Client Documents:** versioned briefs, publishing packets, comments, suggestions, formal approvals, and share/review state.
- **Projects/Kanban:** task ownership, approval gates, human/agent assignment, status, dependencies, and production tracking.
- **Campaign cockpit:** shared content/social workspace already has a Videos tab pattern that can be extended or linked.
- **Social accounts and scheduling:** useful patterns for connected account state, approvals, scheduling, and route-scoped portal access.
- **Hermes skills:** existing skill architecture can be extended with YouTube-specific skills for research, scripting, clipping, metadata, readiness checks, and analytics.

The module should not create a parallel task, document, research, or approval system. It should create YouTube-specific records that link to existing PiB collaboration primitives.

### YouTube Platform Constraints

YouTube Data API uploads are possible through `videos.insert`, but the upload surface is policy-sensitive. Metadata includes privacy status, made-for-kids state, publish scheduling, and synthetic media fields. Source: [YouTube Data API videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert).

API access is not automatically unlimited. Projects can be subject to quota and compliance audit requirements, and unverified upload projects can face restrictions such as private-only uploads. Source: [YouTube API quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).

YouTube requires creators to disclose realistic altered or synthetic content. The module must treat AI disclosure as a publishing gate, not a footer note. Source: [YouTube altered or synthetic content disclosure](https://support.google.com/youtube/answer/14328491).

YouTube Shorts are vertical or square videos up to three minutes. Shorts over one minute with active Content ID claims can be blocked globally. Source: [YouTube Shorts upload requirements](https://support.google.com/youtube/answer/15424877?hl=en-EN).

YouTube monetization policies punish low-effort repetitive or reused content. AI-assisted production must be reviewable, differentiated, and value-adding. Source: [YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392).

YouTube Analytics and Reporting APIs can provide channel and video reporting, but analytics should be modelled as delayed, partial, and source-specific. Sources: [YouTube Analytics channel reports](https://developers.google.com/youtube/analytics/channel_reports), [YouTube Reporting API](https://developers.google.com/youtube/reporting).

Research based on YouTube search should be treated as directional rather than perfectly representative. Independent audits have found instability and bias risks in YouTube search data collection. Source: [arXiv YouTube search audit](https://arxiv.org/abs/2506.11727).

## Recommended Product Position

Recommended V1: **internal PiB YouTube Channel Studio with client request/review and admin publishing gate**.

This means:

- Admin/PiB/Hermes users create and operate channel projects.
- Clients get a portal surface for requests, footage uploads, comments, approvals, and analytics.
- The module supports both clip extraction and full video production.
- Publishing is controlled by PiB admins in V1.
- API upload can be introduced as a controlled adapter, but manual/private-first publishing remains acceptable and safer for initial rollout.

The alternatives are weaker for V1:

| Option | What it means | Advantages | Risks | Fit for V1 |
| --- | --- | --- | --- | --- |
| Production Cockpit | PiB admins and Hermes agents run production; clients review/approve through portal. | Matches PiB shared workspace pattern; keeps risky actions behind staff review; fastest way to ship real operations. | PiB remains responsible for throughput and QA. | Best fit. |
| Series Studio | Series, seasons, episodes, and recurring formats lead the product. | Excellent for creator planning and recurring content strategy. | Can become a planner before it solves production, publishing, and approval operations. | Good sub-surface inside cockpit. |
| Analytics Command Desk | Retention, CTR, tests, and next actions lead the product. | Valuable for mature channels with enough historical data. | Weak for new clients and production setup. | Later layer after V1 produces videos. |

## V1 Operating Model

### Personas

- **PiB operator:** owns channel setup, production flow, client communication, and final publish decisions.
- **Hermes specialist:** performs bounded work such as research, script drafts, clip suggestions, metadata, thumbnail briefs, captions, and analytics summaries.
- **Client requester:** requests videos, uploads footage, supplies context, and approves/rejects client-safe artifacts.
- **QA/release reviewer:** checks rights, AI disclosure, made-for-kids status, metadata, thumbnail, claims risk, and final packet readiness.
- **Data analyst:** imports analytics, finds retention/CTR opportunities, and creates next-cycle briefs.

### End-to-End Workflow

1. Create or connect a YouTube channel workspace under a client organisation.
2. Capture channel strategy: audience, offers, brand rules, content pillars, topics to avoid, compliance notes, and review preferences.
3. Create or link a series when videos belong to a recurring format.
4. Start a video project from one of four intake paths:
   - raw footage upload,
   - source URL/transcript,
   - research-to-video brief,
   - client portal request.
5. Generate a structured video brief with objective, audience, hook, story arc, assets required, title direction, target format, and approval requirements.
6. Assign Hermes jobs for research, script, clip detection, captions, thumbnail brief, title/metadata, and readiness checks.
7. Track production through the Projects/Kanban task bus and YouTube-specific statuses.
8. Present client-safe drafts in the portal for comments, change requests, and approvals.
9. Build a publishing packet with title, description, tags, thumbnail, chapters, captions, disclosure, visibility, schedule, and QA evidence.
10. Publish or schedule only after admin final gate.
11. Import analytics and convert performance findings into next actions: re-title, thumbnail swap, Shorts pack, follow-up video, or series adjustment.

## Screens And Interface

### Admin YouTube Studio Index

Purpose: command center for all client channel work.

Core UI:

- Organisation/channel filter.
- Status filters: setup, strategy, intake, production, client review, publish ready, scheduled, live, blocked.
- Risk filters: missing rights, AI disclosure needed, made-for-kids unresolved, upload account disconnected, analytics stale.
- Stat cards: active videos, approvals waiting, agent jobs running, publish-ready packets, live videos this month.
- Work queue grouped by urgency.
- Quick actions: create channel workspace, start video project, request footage, import analytics, create series.

### Admin Channel Detail

Purpose: one operational view for a client channel.

Sections:

- Overview: channel health, connected account state, publishing gate state, brand/profile summary.
- Strategy: audience, pillars, offers, series map, upload cadence, avoid list.
- Pipeline: video projects by status.
- Series: recurring shows and format templates.
- Assets: footage, thumbnails, captions, voiceover, source links, transcripts, rights notes.
- Approvals: client and internal review requirements.
- Analytics: channel-level metrics, trends, and next actions.
- Settings: API connection, publishing defaults, module access, approval policy.

### Admin Video Project Detail

Purpose: the main production cockpit for one video.

Layout:

- Left rail: series context, source assets, production checklist, linked tasks.
- Center: production board and draft preview state.
- Right rail: Hermes jobs, comments, approvals, risk checks, publish packet.

Tabs:

- Brief.
- Script and outline.
- Clips.
- Edit/render package.
- Thumbnail.
- Metadata.
- Review.
- Publishing.
- Analytics.

### Portal YouTube Studio Index

Purpose: client-safe request and review surface.

Clients can:

- Submit video requests.
- Upload raw footage and context.
- View production status.
- Open drafts available for review.
- Comment and request changes.
- Approve or reject artifacts.
- View published videos and analytics summaries.

Clients cannot in V1:

- Publicly publish.
- Change connected account credentials.
- Override AI disclosure, made-for-kids, rights, or visibility gates.
- See internal risk notes unless PiB marks them client-visible.
- Run arbitrary expensive generation jobs.

### Portal Video Review Detail

Purpose: simple client review workspace.

Client sees:

- Current brief or draft.
- Embedded video preview or asset unavailable state.
- Title and thumbnail options.
- Requested decision: approve, request changes, provide missing footage, confirm disclosure, confirm factual accuracy.
- Comments and change-request history.
- Status timeline and expected next step.

### Analytics View

Purpose: turn performance into next work.

Views:

- Channel summary.
- Series summary.
- Video detail.
- Shorts pack summary.
- Experiment queue.
- Recommendations.

Metrics should include:

- Views.
- Watch time.
- Average view duration.
- Average view percentage.
- Impressions.
- Impressions CTR.
- Subscribers gained/lost.
- Likes/comments/shares where available.
- Traffic source.
- Geography/audience dimensions where useful.
- Publishing cadence.
- Client-facing summary.

Analytics must separate:

- API-imported metrics.
- Manually-entered metrics.
- Estimated or partial metrics.
- Period snapshots.
- Recommendations generated from metrics.

## Video Types To Support

V1 should support a taxonomy instead of one generic video type.

### Shorts And Clips

- Raw footage highlights.
- Podcast/webinar clips.
- Testimonial clips.
- Before/after clips.
- FAQ clips.
- Quote clips.
- Product/service tip clips.
- Vertical social cutdowns.
- Shorts packs generated from a long-form source.

### Long-Form Videos

- Explainers.
- Tutorials.
- Service walkthroughs.
- Product demos.
- Case studies.
- Client success stories.
- Founder/operator updates.
- Educational lessons.
- Webinar/podcast episodes.
- Event recaps.
- Industry commentary.
- Sales enablement videos.

### Series Formats

- Weekly tips.
- Client wins.
- Behind the build.
- Problem/solution lessons.
- Ask PiB/client FAQ.
- Myth vs reality.
- Local business spotlight.
- Campaign breakdown.
- Product/service deep dive.
- Shorts-first recurring segments.

### Ads And Campaign Videos

- YouTube ad creative.
- Retargeting videos.
- Offer explainers.
- Landing page support videos.
- Launch trailers.
- Testimonial ads.

Ads can be tracked in the module, but paid campaign buying remains in Ads/Marketing modules. The YouTube module should create and package ad-ready video assets, not replace ad management.

## Series Management

Series are first-class records because recurring formats reduce production friction and make Hermes outputs more consistent.

Series should store:

- Name.
- Client org.
- Channel id.
- Objective.
- Audience.
- Format type.
- Episode cadence.
- Target duration.
- Hook pattern.
- Structure template.
- Visual style notes.
- Thumbnail style notes.
- Intro/outro rules.
- Reusable disclaimers.
- Episode numbering rules.
- Allowed video types.
- Current season.
- Active/inactive status.

Series should support:

- Ordered episode list.
- Season grouping.
- Topic backlog.
- Episode templates.
- Continuity notes.
- "Turn this Short into a full video" workflow.
- "Generate Shorts pack from episode" workflow.
- Analytics rollup by series.

## AI-Assisted Production

The module should expose AI assistance as controlled jobs with inputs, outputs, ownership, and review state.

### Full Video Creation

Inputs:

- objective,
- audience,
- topic,
- source research,
- brand rules,
- desired format,
- target length,
- assets available,
- claims/facts that need verification,
- client approval requirements.

Outputs:

- video brief,
- hook options,
- outline,
- script,
- shot list,
- b-roll list,
- thumbnail brief,
- title/description variants,
- chapters,
- captions plan,
- publish readiness checklist.

### Clip Production

Inputs:

- source video or transcript,
- target clip count,
- target duration,
- audience,
- desired formats,
- excluded sections,
- brand rules.

Outputs:

- candidate clip ranges,
- reason for each clip,
- hook line,
- title,
- caption text,
- Shorts metadata,
- crop guidance,
- risk notes,
- derivative tasks.

### Render/Edit Adapter

V1 should not build a full NLE-style editor. It should support render/edit packages:

- source media references,
- selected clip ranges,
- transcript segments,
- caption style,
- voiceover reference,
- thumbnail brief,
- aspect ratio,
- output target,
- edit notes,
- external tool status.

Future adapters can connect Remotion, HyperFrames, FFmpeg, Runway, CapCut-style export flows, or other approved tooling. The PiB record remains the production source of truth.

## Hermes Skills

The first YouTube skill family should be:

| Skill | Responsibility | Input | Output |
| --- | --- | --- | --- |
| `youtube-channel-strategy` | Define channel positioning, pillars, cadence, and risks. | org, brand profile, goals, current channel data | channel strategy artifact |
| `youtube-series-planner` | Create recurring series and episode templates. | strategy, audience, offers, existing topics | series plan |
| `youtube-video-brief` | Build a production brief for one video. | topic/request/source/research | video brief |
| `youtube-research-to-video` | Convert Research findings into video concepts. | research item, audience, offer | concept set and recommended brief |
| `youtube-script-writer` | Draft outline, hook, script, chapters. | brief, brand rules, target length | script package |
| `youtube-clip-finder` | Identify clip candidates from transcripts/source video. | transcript/source ranges, objectives | clip candidate list |
| `youtube-shorts-packager` | Package clips into Shorts-ready briefs. | clip candidates, brand rules | Shorts pack |
| `youtube-thumbnail-brief` | Create thumbnail creative directions. | brief/script/title strategy | thumbnail brief and variants |
| `youtube-title-metadata` | Generate titles, descriptions, tags, chapters. | brief, transcript, goals | metadata packet |
| `youtube-captions-chapters` | Prepare captions and chapters. | transcript, video structure | caption/chapter package |
| `youtube-ai-disclosure-check` | Flag altered/synthetic content disclosure needs. | production packet, assets, AI job history | disclosure recommendation |
| `youtube-rights-check` | Check asset rights and missing confirmations. | asset list, uploads, source notes | rights checklist |
| `youtube-publish-readiness` | Validate final packet before publish. | metadata, assets, approvals, disclosure | pass/block result |
| `youtube-analytics-import` | Import or normalize metrics. | API/report/manual data | analytics snapshots |
| `youtube-retention-review` | Explain performance and weak moments. | video metrics, transcript, timeline | findings and fixes |
| `youtube-next-video-brief` | Turn analytics into next production actions. | analytics findings, strategy, series | next brief/task suggestions |

Skill outputs must be stored as artifacts or comments with actor metadata. A skill should never silently mutate publish state without an explicit task or approval transition.

## Data Model

The implementation plan should confirm exact names against existing conventions, but the design should use these core entities.

### Shared Policy Types

```ts
interface YouTubeApprovalPolicy {
  requireInternalBriefApproval: boolean
  requireClientBriefApproval: boolean
  requireClientScriptApproval: boolean
  requireClientDraftApproval: boolean
  requireClientThumbnailApproval: boolean
  requireClientPublishConfirmation: boolean
  requireInternalPublishApproval: boolean
}

interface YouTubePublishingPolicy {
  allowedModes: Array<'manual_handoff' | 'private_api_upload' | 'scheduled_api_publish'>
  defaultVisibility: 'private' | 'unlisted' | 'public'
  privateFirstRequired: boolean
  publicPublishRequiresAdmin: boolean
  publicPublishRequiresClientConfirmation: boolean
}
```

### Channel Workspace

```ts
type YouTubeChannelStatus =
  | 'setup'
  | 'strategy'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'archived'

interface YouTubeChannelWorkspace {
  id: string
  orgId: string
  title: string
  youtubeChannelId?: string
  youtubeHandle?: string
  status: YouTubeChannelStatus
  connectedAccountId?: string
  strategyDocumentId?: string
  defaultApprovalPolicy: YouTubeApprovalPolicy
  defaultPublishingPolicy: YouTubePublishingPolicy
  contentPillars: string[]
  audienceNotes: string
  avoidTopics: string[]
  aiDisclosureDefaults: {
    syntheticMediaLikely: boolean
    notes?: string
  }
  createdAt: unknown
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  updatedAt: unknown
  updatedBy: string
  updatedByType: 'user' | 'agent' | 'system'
  deleted: boolean
}
```

### Series

```ts
interface YouTubeSeries {
  id: string
  orgId: string
  channelWorkspaceId: string
  name: string
  objective: string
  audience: string
  format: 'shorts' | 'long_form' | 'podcast' | 'case_study' | 'tutorial' | 'ads' | 'mixed'
  cadence: 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'campaign' | 'ad_hoc'
  targetDurationSeconds?: number
  episodeTemplate: {
    hook: string
    sections: Array<{ label: string; targetSeconds?: number; notes?: string }>
    outro?: string
  }
  styleGuide: {
    visualNotes?: string
    thumbnailNotes?: string
    captionNotes?: string
    introOutroRules?: string
  }
  season?: string
  status: 'active' | 'paused' | 'complete' | 'archived'
  deleted: boolean
}
```

### Video Project

```ts
type YouTubeVideoType =
  | 'short'
  | 'long_form'
  | 'clip_pack'
  | 'podcast_episode'
  | 'webinar_cutdown'
  | 'testimonial'
  | 'case_study'
  | 'tutorial'
  | 'product_demo'
  | 'ad_creative'
  | 'community_update'

type YouTubeVideoStatus =
  | 'intake'
  | 'briefing'
  | 'production'
  | 'internal_review'
  | 'client_review'
  | 'changes_requested'
  | 'publish_ready'
  | 'scheduled'
  | 'live'
  | 'blocked'
  | 'archived'

interface YouTubeVideoProject {
  id: string
  orgId: string
  channelWorkspaceId: string
  seriesId?: string
  title: string
  workingTitle?: string
  videoType: YouTubeVideoType
  status: YouTubeVideoStatus
  objective: string
  targetAudience?: string
  targetDurationSeconds?: number
  source: {
    intakeType: 'raw_footage' | 'source_url' | 'transcript' | 'research' | 'client_request' | 'manual'
    researchItemId?: string
    campaignId?: string
    projectId?: string
    sourceUrl?: string
    transcriptAssetId?: string
  }
  linked: {
    projectId?: string
    taskIds?: string[]
    documentIds?: string[]
    campaignId?: string
    socialPostIds?: string[]
  }
  approvalPolicy: YouTubeApprovalPolicy
  publishPacketId?: string
  youtubeVideoId?: string
  scheduledAt?: unknown
  publishedAt?: unknown
  deleted: boolean
}
```

### Publishing Packet

```ts
interface YouTubePublishingPacket {
  id: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  versionNumber: number
  supersedesPacketId?: string
  status: 'draft' | 'internal_review' | 'client_review' | 'approved' | 'blocked' | 'published'
  titleOptions: Array<{ text: string; rationale?: string; selected?: boolean }>
  description: string
  tags: string[]
  chapters: Array<{ startSeconds: number; title: string }>
  thumbnailAssetId?: string
  captionAssetId?: string
  videoAssetId?: string
  visibility: 'private' | 'unlisted' | 'public'
  publishAt?: unknown
  selfDeclaredMadeForKids?: boolean
  containsSyntheticMedia?: boolean
  aiDisclosureNotes?: string
  checks: {
    rights: YouTubeGateCheck
    aiDisclosure: YouTubeGateCheck
    madeForKids: YouTubeGateCheck
    metadata: YouTubeGateCheck
    thumbnail: YouTubeGateCheck
    captions: YouTubeGateCheck
    approval: YouTubeGateCheck
    connectedAccount: YouTubeGateCheck
  }
  approvedBy?: string
  approvedAt?: unknown
  approvedSnapshotHash?: string
}

interface YouTubeGateCheck {
  status: 'pass' | 'warning' | 'block' | 'not_applicable'
  message: string
  checkedBy: string
  checkedByType: 'user' | 'agent' | 'system'
  checkedAt: unknown
}
```

### Analytics Snapshot

```ts
interface YouTubeAnalyticsSnapshot {
  id: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  youtubeVideoId?: string
  seriesId?: string
  periodStart: string
  periodEnd: string
  source: 'youtube_analytics_api' | 'youtube_reporting_api' | 'manual_import'
  sourceFreshness: 'fresh' | 'delayed' | 'partial' | 'estimated'
  metrics: {
    views?: number
    watchTimeMinutes?: number
    averageViewDurationSeconds?: number
    averageViewPercentage?: number
    impressions?: number
    impressionsCtr?: number
    subscribersGained?: number
    subscribersLost?: number
    likes?: number
    comments?: number
    shares?: number
  }
  dimensions?: Record<string, string>
  recommendations?: Array<{
    type: 'retitle' | 'thumbnail_test' | 'shorts_pack' | 'follow_up_video' | 'series_change' | 'cadence_change'
    summary: string
    confidence: 'low' | 'medium' | 'high'
  }>
  importedAt: unknown
  importedBy: string
  importedByType: 'user' | 'agent' | 'system'
}
```

## Module Access And Permissions

Add a portal module key:

```ts
type PortalModuleKey = 'mobileApps' | 'youtubeStudio'
```

Default should be conservative:

- Admin can see and manage the module for any permitted organisation.
- Portal visibility depends on `organizations/{orgId}.settings.portalModules.youtubeStudio`.
- Portal users can only access client-safe records for their active organisation.
- Disabled portal module returns a `403 moduleDisabled` style response, matching the Mobile Apps pattern.

Recommended permissions:

| Action | Admin | Portal client | Hermes agent |
| --- | --- | --- | --- |
| Create channel workspace | Yes | No in V1 | Via admin/API task |
| Submit video request | Yes | Yes | Yes |
| Upload footage | Yes | Yes | Yes if assigned |
| Create production brief | Yes | Request only | Yes with review |
| Run expensive generation | Yes | No in V1 | Yes if assigned |
| Comment | Yes | Yes on visible records | Yes |
| Approve client artifact | Yes | Yes where requested | No final approval |
| Approve publish packet | Yes | Client can confirm facts only | No |
| Publish/schedule public video | Yes only | No | No direct public publish |
| View analytics | Yes | Client-safe summary | Yes if assigned |

## Publishing Model

V1 should support three publishing modes:

1. **Manual handoff:** PiB prepares the packet and uploads in YouTube Studio manually.
2. **Private API upload:** adapter uploads private/unlisted first when API credentials and compliance allow.
3. **Scheduled/public API publish:** later controlled mode after successful private upload, readiness gates, and compliance review.

The publishing gate should require:

- connected account present or manual handoff selected,
- video asset selected,
- thumbnail selected,
- title selected,
- description present,
- visibility selected,
- made-for-kids answered,
- synthetic media disclosure answered,
- rights check pass,
- client approval satisfied where configured,
- internal publish packet approval,
- blocker-free readiness result.

The module should record:

- who approved the packet,
- which packet version was approved,
- what checks were visible at approval time,
- upload method,
- external YouTube video id,
- scheduled/public timestamps,
- errors and retry history.

## Analytics And Feedback Loop

Analytics should be useful even when incomplete.

V1 analytics flow:

1. Import channel/video snapshots through API or manual upload.
2. Store snapshots by period and source.
3. Show metrics in admin and client-safe summaries.
4. Generate Hermes findings:
   - retention drop explanations,
   - title/thumbnail mismatch,
   - Shorts opportunities,
   - weak hook,
   - strong topic cluster,
   - follow-up video recommendation.
5. Convert findings into tasks, video briefs, or series updates.

The UI should avoid false precision:

- label delayed/partial data,
- show reporting period,
- separate channel and video metrics,
- avoid ranking recommendations without enough data,
- let operators mark a recommendation as accepted, rejected, or converted to task.

## Relationships To Existing Modules

### Research

Use Research for:

- competitor/channel research,
- topic research,
- audience research,
- claim/fact sources,
- trend analysis,
- source-backed recommendations.

A YouTube video project can link to one or more Research items.

### Client Documents

Use Client Documents for:

- channel strategy brief,
- video production brief,
- client approval packet,
- publishing packet,
- monthly/quarterly channel report.

Approvals should point to versioned documents or packet versions, never mutable text.

### Projects/Kanban

Use Projects/Kanban for:

- production tasks,
- asset collection tasks,
- Hermes jobs,
- review tasks,
- publishing tasks,
- analytics follow-up tasks.

The YouTube module should show relevant task state inline, but not replace Projects.

### Campaigns/Social/Ads

Use Campaigns/Social/Ads links for:

- launch campaigns,
- YouTube ad creative,
- cross-posting Shorts to other platforms,
- content calendar relationships,
- paid campaign coordination.

The YouTube module is responsible for video production and YouTube readiness. Ads remains responsible for paid media management.

## Guardrails

V1 non-negotiables:

- No autonomous public publishing.
- No client-side public publishing.
- No publish packet approval without rights, AI disclosure, made-for-kids, metadata, thumbnail, and approval checks.
- No claims that YouTube acceptance, monetization, or reach is guaranteed.
- No use of YouTube search/research as a single source of truth.
- No repeated low-effort AI videos without human review and value differentiation.
- No large video files embedded in Firestore documents.
- No hidden AI-generated realistic synthetic media in final packets.
- No automated paid ad launch from this module.

## Devil's Advocate

| Risk | Why it matters | Design response |
| --- | --- | --- |
| Scope explodes into a full video editor | Editing tools are deep, expensive, and hard to polish. | V1 orchestrates assets, briefs, clips, packets, tasks, and adapters. No NLE clone. |
| AI output damages client reputation | Bad scripts, fake claims, poor thumbnails, or repetitive content can harm a brand. | Human review, fact checks, client approvals, and publish readiness gates. |
| Platform API access is harder than expected | Upload quota/compliance and OAuth can block automation. | Manual handoff and private-first upload are valid V1 modes. |
| Clients expect one-click magic | Self-service generation can create support and quality problems. | Portal V1 is request/review/upload/approve, not open-ended generation. |
| Analytics is too thin for new channels | Early videos have limited data and delayed reports. | Label freshness and use analytics as guidance, not certainty. |
| Storage/rendering costs grow quickly | Raw video is heavy. | Store assets externally, keep Firestore as metadata, and use explicit render jobs. |
| Rights and synthetic media are mishandled | YouTube policies and client trust require clarity. | Rights and AI disclosure are first-class gate checks. |
| Agent jobs mutate too much state | Autonomous state changes can make audit messy. | Skills produce artifacts and recommendations; tasks/approvals control state transitions. |
| Module duplicates Campaigns/Social | PiB already has social and campaign workflows. | YouTube owns channel/video production; campaigns/social own cross-platform publishing and marketing coordination. |
| Too many video types slow V1 | Supporting every format can dilute the build. | Taxonomy supports many types, but V1 UI starts with Shorts, long-form, clips, testimonials, tutorials, case studies, and ads-ready assets. |

## Phasing

### Phase 1: Production Cockpit Foundation

- Add `youtubeStudio` portal module switch.
- Create YouTube channel workspace records.
- Create series records.
- Create video project records.
- Build shared admin/portal workspace shell.
- Build client request/upload/review flow.
- Link projects/tasks/documents/research.
- Create publishing packet and readiness gate model.

### Phase 2: Hermes Production Skills

- Implement channel strategy, series planner, video brief, script writer, clip finder, Shorts packager, title/metadata, thumbnail brief, disclosure check, rights check, and publish readiness skills.
- Store outputs as artifacts/comments with actor metadata.
- Add agent job status to the cockpit.

### Phase 3: Publishing Adapter

- Add connected YouTube account state.
- Support manual handoff packets.
- Add private/unlisted upload where API access allows.
- Add scheduled/public publishing only after V1 gates are proven.

### Phase 4: Analytics Loop

- Import analytics snapshots through API/manual reports.
- Add admin analytics dashboard.
- Add client-safe analytics summaries.
- Generate next action recommendations.
- Convert recommendations into tasks, briefs, or series updates.

### Phase 5: Wider Self-Service

- Let selected clients start guided briefs and clip requests.
- Add controlled generation quotas.
- Add more advanced series planning and experiments.
- Consider direct client generation only after quality, cost, and policy gates are stable.

## V1 Success Criteria

V1 is successful when:

- PiB can create a client YouTube channel workspace and enable/disable portal visibility by organisation.
- PiB can create a series and multiple video projects under it.
- A client can request a video, upload/source content, comment, and approve/reject a client-safe artifact.
- Hermes can produce bounded draft artifacts that are visible, reviewable, and auditable.
- A PiB operator can assemble a publishing packet and see exactly which gates pass, warn, or block.
- Public publishing is impossible until the admin final gate is satisfied.
- Published video metrics can be imported and shown as labelled snapshots.
- Analytics recommendations can become tasks or next-video briefs.

## Out Of Scope For V1

- Full timeline video editor.
- Fully autonomous public upload.
- Client-controlled public publishing.
- Paid ad campaign buying.
- YouTube monetization management.
- Content ID dispute handling.
- Deep audience segmentation beyond available analytics summaries.
- Multi-platform video publishing beyond links to Social/Campaigns.
- Billing/quotas for public SaaS users.
- Public self-serve AI video product.

## Spec Review Notes

This spec intentionally chooses an operational cockpit over a broad self-serve generator. The core reason is risk control: video publishing touches platform policy, client reputation, AI disclosure, media rights, storage/rendering cost, and external API limits. The module should prove quality internally first, then open more self-service once PiB has reliable gates and analytics.

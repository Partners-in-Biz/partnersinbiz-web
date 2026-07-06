import { buildWorkQueue, WORK_QUEUE_GROUPS } from '@/lib/youtube-studio/work-queue'
import type {
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeRenderJob,
  YouTubeVideoProject,
} from '@/lib/youtube-studio/types'

function video(id: string, status: YouTubeVideoProject['status'], extra: Partial<YouTubeVideoProject> = {}): YouTubeVideoProject {
  return {
    id,
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    title: `Video ${id}`,
    objective: 'Grow the channel',
    videoType: 'long_form',
    status,
    visibility: { showInClientPortal: true },
    deleted: false,
    ...extra,
  } as YouTubeVideoProject
}

const emptyInput = { videos: [], packets: [], productionDrafts: [], renderJobs: [] }

describe('buildWorkQueue', () => {
  it('exposes the four cockpit groups in display order', () => {
    expect(WORK_QUEUE_GROUPS.map((group) => group.key)).toEqual([
      'needs_input',
      'in_production',
      'ready_to_review',
      'scheduled_live',
    ])
    expect(WORK_QUEUE_GROUPS.map((group) => group.label)).toEqual([
      'Needs your input',
      'In production',
      'Ready to review',
      'Scheduled & live',
    ])
  })

  it('groups videos by status', () => {
    const groups = buildWorkQueue({
      ...emptyInput,
      videos: [
        video('v-review', 'client_review'),
        video('v-changes', 'changes_requested'),
        video('v-intake', 'intake'),
        video('v-prod', 'production'),
        video('v-ready', 'publish_ready'),
        video('v-scheduled', 'scheduled'),
        video('v-live', 'live'),
        video('v-blocked', 'blocked'),
        video('v-archived', 'archived'),
      ],
    })
    expect(groups.needs_input.map((item) => item.id)).toEqual(['v-blocked', 'v-review'])
    expect(groups.in_production.map((item) => item.id)).toEqual(['v-changes', 'v-intake', 'v-prod'])
    expect(groups.ready_to_review.map((item) => item.id)).toEqual(['v-ready'])
    expect(groups.scheduled_live.map((item) => item.id)).toEqual(['v-live', 'v-scheduled'])
  })

  it('treats a requested client review as needing input even outside client_review status', () => {
    const groups = buildWorkQueue({
      ...emptyInput,
      videos: [video('v1', 'internal_review', { clientReview: { status: 'requested' } } as Partial<YouTubeVideoProject>)],
    })
    expect(groups.needs_input.map((item) => item.id)).toEqual(['v1'])
    expect(groups.in_production).toHaveLength(0)
  })

  it('queues packets, drafts and render jobs only in client-decision or ready states', () => {
    const packets = [
      { id: 'p-review', status: 'client_review', videoProjectId: 'v1', versionNumber: 1 },
      { id: 'p-approved', status: 'approved', videoProjectId: 'v1', versionNumber: 1 },
      { id: 'p-draft', status: 'draft', videoProjectId: 'v1', versionNumber: 1 },
    ] as unknown as YouTubePublishingPacket[]
    const productionDrafts = [
      { id: 'd-review', status: 'client_review', title: 'Script v2', videoProjectId: 'v1', versionNumber: 2 },
      { id: 'd-internal', status: 'internal_review', title: 'Script v1', videoProjectId: 'v1', versionNumber: 1 },
    ] as unknown as YouTubeProductionDraft[]
    const renderJobs = [
      { id: 'r-qa', status: 'qa_review', title: 'Cut A', videoProjectId: 'v1', versionNumber: 1 },
      { id: 'r-approved', status: 'approved', title: 'Cut B', videoProjectId: 'v1', versionNumber: 2, output: { previewUrl: 'https://x.test/b.mp4' } },
      { id: 'r-approved-no-output', status: 'approved', title: 'Cut C', videoProjectId: 'v1', versionNumber: 3 },
      { id: 'r-rendering', status: 'rendering', title: 'Cut D', videoProjectId: 'v1', versionNumber: 4 },
    ] as unknown as YouTubeRenderJob[]

    const groups = buildWorkQueue({ videos: [], packets, productionDrafts, renderJobs })
    expect(groups.needs_input.map((item) => item.key)).toEqual([
      'packet:p-review',
      'production_draft:d-review',
      'render_job:r-qa',
    ])
    expect(groups.ready_to_review.map((item) => item.key)).toEqual(['packet:p-approved', 'render_job:r-approved'])
    expect(groups.in_production).toHaveLength(0)
  })

  it('skips records without ids and reports a total pending count', () => {
    const groups = buildWorkQueue({ ...emptyInput, videos: [video('', 'client_review'), video('v1', 'client_review')] })
    expect(groups.needs_input).toHaveLength(1)
  })
})

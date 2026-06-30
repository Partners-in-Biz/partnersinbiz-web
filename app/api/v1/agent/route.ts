/**
 * GET /api/v1/agent — List all available agent-accessible endpoints
 *
 * Returns a manifest of endpoints that AI agents can use.
 */
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  return apiSuccess({
    version: 'v1',
    endpoints: {
      projectContext: {
        method: 'GET',
        path: '/api/v1/agent/project/{projectId}',
        description: 'Get full project context for an AI agent including project details, all documents, tasks, and recent comments',
        example: {
          request: 'GET /api/v1/agent/project/proj-123',
          response: {
            success: true,
            data: {
              project: {
                name: 'Q2 Marketing Campaign',
                status: 'active',
                description: 'Campaign brief...',
                brief: 'Launch new product line...',
                orgId: 'org-456',
              },
              documents: [
                {
                  title: 'Project Requirements',
                  content: '# Requirements\n...',
                  type: 'requirements',
                },
              ],
              tasks: [
                {
                  title: 'Design hero section',
                  description: '...',
                  priority: 'high',
                  columnId: 'in_progress',
                  attachments: [],
                },
              ],
              recentComments: [
                {
                  taskId: 'task-789',
                  text: 'Please update the copy',
                  userId: 'user-456',
                  userName: 'John Admin',
                  createdAt: '2025-04-13T10:30:00Z',
                },
              ],
            },
          },
        },
      },
      brand: {
        method: 'GET',
        path: '/api/v1/agent/brand/{orgId}',
        description: 'Fetch brand profile for an organization (for content generation context)',
        params: {
          orgId: 'string (required) — organization ID',
        },
        example: {
          request: 'GET /api/v1/agent/brand/org-123',
          response: {
            success: true,
            data: {
              orgId: 'org-123',
              name: 'Acme Corp',
              industry: 'Technology',
              brandProfile: {
                logoUrl: 'https://...',
                tagline: 'Build faster, grow smarter',
                toneOfVoice: 'Professional but approachable',
                targetAudience: 'SMB founders in tech',
                doWords: ['innovative', 'partner'],
                dontWords: ['cheap', 'basic'],
                fonts: { heading: 'Inter', body: 'DM Sans' },
                socialHandles: { twitter: '@acmecorp', linkedin: 'company/acme-corp' },
                guidelines: 'Markdown-formatted brand guidelines...',
              },
              brandColors: { primary: '#...' },
            },
          },
        },
      },
      inbox: {
        method: 'GET',
        path: '/api/v1/agent/inbox',
        description: 'Poll for unactioned comments from clients and admins across tasks and social posts',
        params: {
          source: 'task|social_post (optional) — filter by comment source',
          limit: 'number (optional, default 50, max 200) — max results to return',
          includeHandled: 'boolean (optional, default false) — include already-processed comments for debugging',
        },
        example: {
          request: 'GET /api/v1/agent/inbox?source=task&limit=20',
          response: {
            success: true,
            data: {
              comments: [
                {
                  id: 'comment-123',
                  text: 'Please update the hero section',
                  userId: 'user-456',
                  userName: 'John Admin',
                  userRole: 'admin',
                  createdAt: '2025-04-13T10:30:00Z',
                  source: 'task',
                  projectId: 'proj-789',
                  taskId: 'task-101',
                  markHandledUrl: '/api/v1/projects/proj-789/tasks/task-101/comments/comment-123',
                },
              ],
              total: 1,
            },
          },
        },
      },
      growthCommandQueue: {
        method: 'GET',
        path: '/api/v1/agent/growth-command-queue',
        description: 'Read-only CEO growth command queue that gathers stored CRM, Marketing Studio, failed-social, and briefing evidence for on-demand chat analysis. Use this before proposing dashboards or external actions.',
        params: {
          orgId: 'string (required for browser/admin query param or X-Org-Id for AI agents) — organization ID',
        },
        safety: {
          readOnly: true,
          dashboardPolicy: 'Do not create a permanent dashboard by default. Gather stored data, analyze the current question, and answer in Messages.',
          blockedWithoutApproval: ['send', 'publish', 'schedule', 'retry', 'reconnect', 'spend', 'deploy', 'billing', 'destructive', 'client-visible'],
        },
      },
      markHandled: {
        description: 'Mark a comment as processed by the agent',
        task: {
          method: 'PATCH',
          path: '/api/v1/projects/{projectId}/tasks/{taskId}/comments/{commentId}',
          body: '{ agentPickedUp: true }',
        },
        socialPost: {
          method: 'PATCH',
          path: '/api/v1/social/posts/{postId}/comments/{commentId}',
          body: '{ agentPickedUp: true }',
        },
      },
      approvePost: {
        method: 'POST',
        path: '/api/v1/social/posts/{id}/approve',
        description: 'Approve or reject a pending social post',
        body: '{ action: "approve" | "reject" }',
      },
      publishPost: {
        method: 'POST',
        path: '/api/v1/social/posts/{id}/publish',
        description: 'Publish an approved social post immediately',
        body: '{}',
      },
    },
  })
})

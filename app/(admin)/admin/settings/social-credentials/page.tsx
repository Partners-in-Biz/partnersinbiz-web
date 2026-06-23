import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminSocialCredentialsPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/social-credentials"
      eyebrow="Admin backlog"
      title="Social API credentials"
      summary="Masked OAuth app configuration and callback inventory for the social integrations stack."
    />
  )
}

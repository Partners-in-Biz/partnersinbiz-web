import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { communicationProviders } from '@/lib/communications/providers'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async () => {
  return apiSuccess({
    providers: communicationProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      supports: provider.supports,
      readiness: provider.getReadiness(),
    })),
  })
})

import { apiSuccess } from '@/lib/api/response'
import { probeAllServices } from '@/lib/observability/health-probe'

export const dynamic = 'force-dynamic'

export async function GET() {
  const services = await probeAllServices()
  const overall = services.some((service) => service.status === 'down')
    ? 'down'
    : services.some((service) => service.status === 'degraded')
      ? 'degraded'
      : 'ok'

  return apiSuccess({
    overall,
    checkedAt: services[0]?.lastCheckedAt ?? new Date().toISOString(),
    services: services.map((service) => ({
      key: service.key,
      name: service.name,
      status: service.status,
      latencyMs: service.latencyMs,
      latencyInstrumented: service.latencyInstrumented,
    })),
  })
}

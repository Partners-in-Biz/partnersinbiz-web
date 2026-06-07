import { createGeoSeoItemHandlers, geoSeoConfigs } from '@/lib/geo-seo/api'

export const dynamic = 'force-dynamic'

const handlers = createGeoSeoItemHandlers(geoSeoConfigs.workspaces)

export const GET = handlers.GET
export const PATCH = handlers.PATCH

import { createGeoSeoCollectionHandlers, geoSeoConfigs } from '@/lib/geo-seo/api'

export const dynamic = 'force-dynamic'

const handlers = createGeoSeoCollectionHandlers(geoSeoConfigs.checkRuns)

export const GET = handlers.GET
export const POST = handlers.POST

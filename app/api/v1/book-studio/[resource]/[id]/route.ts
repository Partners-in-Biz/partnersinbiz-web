import { createBookStudioRecordHandlers } from '@/lib/book-studio/routes'

export const dynamic = 'force-dynamic'

const handlers = createBookStudioRecordHandlers()

export const PATCH = handlers.PATCH

export const CRM_LIVE_UPDATES_COLLECTION = 'crm_live_updates'

export const CRM_LIVE_ENTITIES = ['companies', 'contacts'] as const

export type CrmLiveEntity = (typeof CRM_LIVE_ENTITIES)[number]

export function isCrmLiveEntity(value: unknown): value is CrmLiveEntity {
  return typeof value === 'string' && CRM_LIVE_ENTITIES.includes(value as CrmLiveEntity)
}

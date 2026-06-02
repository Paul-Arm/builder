import type { UpdateGrafanaSettingsRequest } from '~~/types/observability'
import { updateGrafanaSettings } from '../../../utils/observability-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<UpdateGrafanaSettingsRequest>(event)

  return updateGrafanaSettings(body)
})

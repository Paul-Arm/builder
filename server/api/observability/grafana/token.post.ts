import type { SaveGrafanaTokenRequest } from '~~/types/observability'
import { saveGrafanaToken } from '../../../utils/observability-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<SaveGrafanaTokenRequest>(event)

  return saveGrafanaToken(body.token)
})

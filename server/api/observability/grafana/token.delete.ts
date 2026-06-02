import { deleteGrafanaToken } from '../../../utils/observability-store'

export default defineEventHandler(async () => {
  return deleteGrafanaToken()
})

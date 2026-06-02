import { readGrafanaState } from '../../../utils/observability-store'

export default defineEventHandler(async () => {
  return readGrafanaState()
})

import type { DeploymentActionRequest } from '~~/types/providers'
import { executeProviderAction } from '../../providers/registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<DeploymentActionRequest>(event)

  return executeProviderAction(body)
})

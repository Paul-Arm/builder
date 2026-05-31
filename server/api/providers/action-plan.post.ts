import type { DeploymentActionRequest } from '~~/types/providers'
import { planProviderAction } from '../../providers/registry'

export default defineEventHandler(async (event) => {
  const body = await readBody<DeploymentActionRequest>(event)

  return planProviderAction(body)
})

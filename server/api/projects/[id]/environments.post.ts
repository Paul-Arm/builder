import type { CreateProjectEnvironmentRequest } from '~~/types/projects'
import { readInventoryFromRuntimeConfig } from '../../../utils/runtime-inventory'
import { createProjectEnvironment } from '../../../utils/project-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateProjectEnvironmentRequest>(event)
  const projectId = getRouterParam(event, 'id') || ''

  return createProjectEnvironment(projectId, body, await readInventoryFromRuntimeConfig())
})

import type { CreateProjectNodeRequest } from '~~/types/projects'
import { readInventoryFromRuntimeConfig } from '../../../utils/runtime-inventory'
import { createProjectNode } from '../../../utils/project-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateProjectNodeRequest>(event)
  const projectId = getRouterParam(event, 'id') || ''

  return createProjectNode(projectId, body, await readInventoryFromRuntimeConfig())
})

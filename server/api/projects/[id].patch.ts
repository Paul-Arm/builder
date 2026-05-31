import type { UpdateProjectRequest } from '~~/types/projects'
import { readInventoryFromRuntimeConfig } from '../../utils/runtime-inventory'
import { updateProject } from '../../utils/project-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<UpdateProjectRequest>(event)
  const projectId = getRouterParam(event, 'id') || ''

  return updateProject(projectId, body, await readInventoryFromRuntimeConfig())
})

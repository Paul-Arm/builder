import { getRouterParam, readBody } from 'h3'
import { readInventoryFromRuntimeConfig } from '../../../utils/runtime-inventory'
import { createProjectRelation } from '../../../utils/project-store'
import type { CreateProjectRelationRequest } from '~~/types/projects'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'id') || ''
  const body = await readBody<CreateProjectRelationRequest>(event)
  return createProjectRelation(projectId, body, await readInventoryFromRuntimeConfig())
})

import { getRouterParam } from 'h3'
import { readInventoryFromRuntimeConfig } from '../../../../utils/runtime-inventory'
import { deleteProjectRelation } from '../../../../utils/project-store'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'id') || ''
  const relationId = getRouterParam(event, 'relationId') || ''
  return deleteProjectRelation(projectId, relationId, await readInventoryFromRuntimeConfig())
})

import type { CreateProjectRequest } from '~~/types/projects'
import { readInventoryFromRuntimeConfig } from '../utils/runtime-inventory'
import { createProject } from '../utils/project-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateProjectRequest>(event)

  return createProject(body, await readInventoryFromRuntimeConfig())
})

import { readInventoryFromRuntimeConfig } from '../utils/runtime-inventory'
import { readProjectWorkspace } from '../utils/project-store'

export default defineEventHandler(async () => {
  return readProjectWorkspace(await readInventoryFromRuntimeConfig())
})

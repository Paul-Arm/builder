import { readInventoryFromRuntimeConfig } from '../../utils/runtime-inventory'
import { readIacBackbone } from '../../utils/iac-backbone'

export default defineEventHandler(async () => {
  return readIacBackbone(await readInventoryFromRuntimeConfig())
})

import { collectProviderRuntime } from '../../providers/registry'

export default defineEventHandler(async () => {
  return collectProviderRuntime()
})

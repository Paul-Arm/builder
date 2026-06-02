import { getDockerManagerState } from '../../../../providers/docker-cli/server'

export default defineEventHandler(async () => {
  return getDockerManagerState()
})

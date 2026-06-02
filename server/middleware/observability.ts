import { performance } from 'node:perf_hooks'
import { getRequestURL } from 'h3'
import {
  logInfo,
  recordApiRequest
} from '../utils/observability-telemetry'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/api/')) {
    return
  }

  const startedAt = performance.now()
  const method = event.method || event.node.req.method || 'GET'
  const route = url.pathname

  event.node.res.on('finish', () => {
    const durationMs = performance.now() - startedAt
    const status = event.node.res.statusCode || 200

    recordApiRequest({
      method,
      route,
      status,
      durationMs
    })

    void logInfo('api_request', {
      method,
      route,
      status,
      durationMs: Math.round(durationMs)
    })
  })
})

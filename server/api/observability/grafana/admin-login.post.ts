import { createError, type H3Event } from 'h3'
import { readGrafanaSettings } from '../../../utils/observability-store'
import type { GrafanaAdminLoginResponse } from '~~/types/observability'

export default defineEventHandler(async (event): Promise<GrafanaAdminLoginResponse> => {
  const settings = await readGrafanaSettings()
  const adminUrl = browserGrafanaUrl(event, settings.baseUrl)

  if (settings.mode !== 'local') {
    return {
      authenticated: false,
      adminUrl,
      message: 'Admin auto login is only available for the local Grafana stack.'
    }
  }

  if (process.env.BUILDER_GRAFANA_ADMIN_AUTO_LOGIN === 'false') {
    return {
      authenticated: false,
      adminUrl,
      message: 'Admin auto login is disabled.'
    }
  }

  const loginBaseUrl = serverGrafanaUrl(settings.baseUrl)
  assertLoopbackUrl(loginBaseUrl)

  const response = await fetch(new URL('/login', ensureTrailingSlash(loginBaseUrl)), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user: process.env.GRAFANA_ADMIN_USER || 'admin',
      password: process.env.GRAFANA_ADMIN_PASSWORD || 'admin'
    }),
    signal: AbortSignal.timeout(3_000)
  })

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage: `Grafana admin login failed: ${response.statusText}`
    })
  }

  const cookies = getSetCookies(response)
  if (!cookies.length) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Grafana login did not return a session cookie'
    })
  }

  event.node.res.setHeader('Set-Cookie', cookies)

  return {
    authenticated: true,
    adminUrl
  }
})

function getSetCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = headers.getSetCookie?.()
  if (cookies?.length) {
    return cookies
  }

  const cookie = response.headers.get('set-cookie')
  return cookie ? splitSetCookie(cookie) : []
}

function splitSetCookie(value: string) {
  return value.split(/,\s*(?=[^;,]+=)/g)
}

function browserGrafanaUrl(event: H3Event, configuredUrl: string) {
  const configured = new URL(configuredUrl)
  const requestHost = String(event.node.req.headers.host || '').split(':')[0] || ''
  const hostname = isLoopbackHost(requestHost) ? requestHost : configured.hostname
  const port = configured.port ? `:${configured.port}` : ''
  return `${configured.protocol}//${hostname}${port}/?orgId=1`
}

function serverGrafanaUrl(configuredUrl: string) {
  return configuredUrl
    .replace('http://localhost:', 'http://127.0.0.1:')
    .replace('http://[::1]:', 'http://127.0.0.1:')
}

function assertLoopbackUrl(value: string) {
  const url = new URL(value)
  if (!isLoopbackHost(url.hostname)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Grafana admin auto login is restricted to loopback URLs.'
    })
  }
}

function isLoopbackHost(value: string) {
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]'
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

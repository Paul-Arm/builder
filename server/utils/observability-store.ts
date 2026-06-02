import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createError } from 'h3'
import { Surreal } from 'surrealdb'
import {
  deleteProviderSecret,
  getProviderSecret,
  providerSecretStatus,
  setProviderSecret
} from './secret-store'
import {
  logWarning,
  recordDbFallback
} from './observability-telemetry'
import type {
  GrafanaConnectionStatus,
  GrafanaDashboardRef,
  GrafanaDashboardSlot,
  GrafanaDashboardSlotView,
  GrafanaMode,
  GrafanaServiceHealth,
  GrafanaServiceId,
  GrafanaSettings,
  GrafanaState,
  GrafanaTokenStatus,
  UpdateGrafanaSettingsRequest
} from '~~/types/observability'

interface SurrealConfig {
  url: string
  namespace: string
  database: string
  username: string
  password: string
}

interface ObservabilitySettingsRecord {
  uid: string
  settings: GrafanaSettings
  updatedAt: string
}

interface ObservabilityStoreFile {
  version: 1
  settings: GrafanaSettings
}

interface GrafanaSearchResult {
  uid?: string
  title?: string
  uri?: string
  url?: string
  folderTitle?: string
  tags?: string[]
}

interface GrafanaServiceCheck {
  id: GrafanaServiceId
  label: string
  displayUrl: string
  healthUrl: string
  disabled: boolean
  auth: boolean
}

const providerId = 'grafana-stack'
const tokenSecretKey = 'api-token'
const settingsUid = 'grafana-settings'
const storePath = process.env.BUILDER_OBSERVABILITY_STORE_PATH
  || join(process.cwd(), '.data', 'observability.json')
const databaseTimeoutMs = numberFromEnv('BUILDER_OBSERVABILITY_DB_TIMEOUT_MS', 650)
const databaseBackoffMs = numberFromEnv('BUILDER_OBSERVABILITY_DB_BACKOFF_MS', 30_000)

let databaseUnavailableUntil = 0

const starterDashboards: GrafanaDashboardRef[] = [
  dashboardRef('builder-overview', 'Builder Overview'),
  dashboardRef('builder-logs', 'Builder Logs'),
  dashboardRef('builder-traces', 'Builder Traces'),
  dashboardRef('builder-metrics', 'Builder Metrics'),
  dashboardRef('builder-providers-db', 'Builder Providers and DB')
]

export async function readGrafanaState(): Promise<GrafanaState> {
  const settings = await readGrafanaSettings()
  const status = await getGrafanaConnectionStatus(settings)

  return {
    settings,
    status,
    slots: slotsWithUrls(settings)
  }
}

export async function readGrafanaSettings(): Promise<GrafanaSettings> {
  const databaseSettings = await readDatabaseSettings()
  if (databaseSettings) {
    return normalizeSettings(databaseSettings)
  }

  return normalizeSettings(await readFileSettings())
}

export async function updateGrafanaSettings(request: UpdateGrafanaSettingsRequest): Promise<GrafanaState> {
  const current = await readGrafanaSettings()
  const next = normalizeSettings({
    ...current,
    mode: normalizeMode(request.mode) || current.mode,
    baseUrl: optionalUrl(request.baseUrl) || current.baseUrl,
    embedBaseUrl: optionalUrl(request.embedBaseUrl) || optionalUrl(request.baseUrl) || current.embedBaseUrl,
    defaultFrom: optionalRange(request.defaultFrom) || current.defaultFrom,
    defaultTo: optionalRange(request.defaultTo) || current.defaultTo,
    slots: mergeSlots(current.slots, request.slots || []),
    updatedAt: new Date().toISOString()
  })

  await writeGrafanaSettings(next)
  return readGrafanaState()
}

export async function searchGrafanaDashboards(query = ''): Promise<GrafanaDashboardRef[]> {
  const settings = await readGrafanaSettings()
  const baseUrl = serverUrlFor(settings.baseUrl)
  const searchUrl = new URL('/api/search', baseUrl)
  searchUrl.searchParams.set('type', 'dash-db')
  if (query.trim()) {
    searchUrl.searchParams.set('query', query.trim())
  }

  try {
    const response = await fetch(searchUrl, {
      headers: await grafanaHeaders(),
      signal: AbortSignal.timeout(2_500)
    })

    if (!response.ok) {
      throw new Error(`Grafana dashboard search returned ${response.status}`)
    }

    const results = await response.json() as GrafanaSearchResult[]
    const dashboards = results
      .filter((result) => result.uid && result.title)
      .map((result) => normalizeDashboardResult(result, settings.baseUrl))

    return dashboards.length ? dashboards : filterStarterDashboards(query)
  } catch (error) {
    void logWarning('grafana_dashboard_search_failed', {
      error: errorMessage(error)
    })
    return filterStarterDashboards(query)
  }
}

export async function saveGrafanaToken(token: string): Promise<GrafanaState> {
  const trimmed = typeof token === 'string' ? token.trim() : ''
  if (!trimmed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Grafana token is required'
    })
  }

  await setProviderSecret(providerId, tokenSecretKey, trimmed)
  return readGrafanaState()
}

export async function deleteGrafanaToken(): Promise<GrafanaState> {
  await deleteProviderSecret(providerId, tokenSecretKey)
  return readGrafanaState()
}

export async function getGrafanaConnectionStatus(
  settings?: GrafanaSettings
): Promise<GrafanaConnectionStatus> {
  const resolvedSettings = settings || await readGrafanaSettings()
  const checkedAt = new Date().toISOString()
  const token = await grafanaTokenStatus()
  const services = await Promise.all(serviceChecksFor(resolvedSettings).map((service) => {
    if (service.disabled) {
      return Promise.resolve({
        id: service.id,
        label: service.label,
        url: service.displayUrl,
        status: 'disabled',
        checkedAt
      } satisfies GrafanaServiceHealth)
    }

    return checkService(service.id, service.label, service.displayUrl, service.healthUrl, checkedAt, service.auth)
  }))

  return {
    configured: services.some((service) => service.id === 'grafana' && service.status === 'connected'),
    mode: resolvedSettings.mode,
    baseUrl: resolvedSettings.baseUrl,
    embedBaseUrl: resolvedSettings.embedBaseUrl,
    token,
    services,
    checkedAt
  }
}

export function defaultGrafanaSettings(): GrafanaSettings {
  const baseUrl = optionalUrl(process.env.BUILDER_GRAFANA_URL) || 'http://localhost:3300'
  const embedBaseUrl = optionalUrl(process.env.BUILDER_GRAFANA_EMBED_URL) || baseUrl

  return {
    version: 1,
    mode: normalizeMode(process.env.BUILDER_GRAFANA_MODE) || 'local',
    baseUrl,
    embedBaseUrl,
    defaultFrom: 'now-6h',
    defaultTo: 'now',
    slots: [
      defaultSlot('slot-1', 1, 'Overview', 'i-lucide-layout-dashboard', 'builder-overview', 'Builder Overview'),
      defaultSlot('slot-2', 2, 'Logs', 'i-lucide-scroll-text', 'builder-logs', 'Builder Logs'),
      defaultSlot('slot-3', 3, 'Traces', 'i-lucide-route', 'builder-traces', 'Builder Traces'),
      defaultSlot('slot-4', 4, 'Metrics', 'i-lucide-chart-line', 'builder-metrics', 'Builder Metrics'),
      defaultSlot('slot-5', 5, 'Providers/DB', 'i-lucide-database', 'builder-providers-db', 'Builder Providers and DB')
    ]
  }
}

function slotsWithUrls(settings: GrafanaSettings): GrafanaDashboardSlotView[] {
  return settings.slots.map((slot) => ({
    ...slot,
    grafanaUrl: dashboardUrlFor(settings.baseUrl, slot),
    embedUrl: dashboardUrlFor(settings.embedBaseUrl, slot, true)
  }))
}

function dashboardUrlFor(baseUrl: string, slot: GrafanaDashboardSlot, embed = false) {
  if (!slot.dashboardUid) {
    return undefined
  }

  const slug = slot.dashboardSlug || slugify(slot.dashboardTitle || slot.label)
  const path = embed && slot.panelId
    ? `/d-solo/${encodeURIComponent(slot.dashboardUid)}/${encodeURIComponent(slug)}`
    : `/d/${encodeURIComponent(slot.dashboardUid)}/${encodeURIComponent(slug)}`
  const url = new URL(path, ensureTrailingSlash(baseUrl))

  url.searchParams.set('orgId', '1')
  url.searchParams.set('from', slot.from)
  url.searchParams.set('to', slot.to)
  url.searchParams.set('theme', 'light')

  if (embed) {
    url.searchParams.set('kiosk', 'tv')
  }

  if (slot.panelId) {
    url.searchParams.set('panelId', slot.panelId)
  }

  return url.toString()
}

function mergeSlots(
  currentSlots: GrafanaDashboardSlot[],
  patchSlots: Array<Partial<GrafanaDashboardSlot> & { id: string }>
) {
  const byId = new Map(currentSlots.map((slot) => [slot.id, slot]))

  for (const patch of patchSlots) {
    const current = byId.get(patch.id)
    if (!current) {
      continue
    }

    byId.set(patch.id, normalizeSlot({
      ...current,
      ...patch
    }, current))
  }

  return defaultGrafanaSettings().slots.map((slot) => normalizeSlot(byId.get(slot.id) || slot, slot))
}

async function readFileSettings(): Promise<GrafanaSettings> {
  try {
    const raw = await readFile(storePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ObservabilityStoreFile>
    return parsed.settings || defaultGrafanaSettings()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return defaultGrafanaSettings()
    }

    throw error
  }
}

async function writeGrafanaSettings(settings: GrafanaSettings) {
  if (await writeDatabaseSettings(settings)) {
    return
  }

  await writeFileSettings(settings)
}

async function writeFileSettings(settings: GrafanaSettings) {
  await mkdir(dirname(storePath), { recursive: true })
  const tmpPath = `${storePath}.${process.pid}.tmp`
  await writeFile(tmpPath, `${JSON.stringify({
    version: 1,
    settings
  } satisfies ObservabilityStoreFile, null, 2)}\n`, 'utf8')
  await rename(tmpPath, storePath)
}

async function readDatabaseSettings() {
  const config = surrealConfigFromEnv()
  if (!config.url || !canUseDatabase()) {
    return undefined
  }

  const db = new Surreal()
  try {
    await withTimeout(connectDatabase(db, config), databaseTimeoutMs, 'Observability database connect timed out')
    const [records] = await withTimeout(db
      .query<[ObservabilitySettingsRecord[]]>(
        'SELECT * FROM observability_settings WHERE uid = $uid LIMIT 1;',
        { uid: settingsUid }
      )
      .json()
      .collect(), databaseTimeoutMs, 'Observability database read timed out')
    await closeQuietly(db)
    return records?.[0]?.settings
  } catch (error) {
    markDatabaseUnavailable()
    recordDbFallback('observability')
    await closeQuietly(db)
    console.warn('[observability-store] Database read failed, falling back to file store:', error)
    return undefined
  }
}

async function writeDatabaseSettings(settings: GrafanaSettings) {
  const config = surrealConfigFromEnv()
  if (!config.url || !canUseDatabase()) {
    return false
  }

  const db = new Surreal()
  try {
    await withTimeout(connectDatabase(db, config), databaseTimeoutMs, 'Observability database connect timed out')
    await withTimeout(db
      .query(
        `
          DEFINE TABLE IF NOT EXISTS observability_settings SCHEMALESS;
          DEFINE INDEX IF NOT EXISTS observability_settings_uid ON observability_settings FIELDS uid UNIQUE;
          DELETE observability_settings WHERE uid = $uid;
          CREATE observability_settings CONTENT $record;
        `,
        {
          uid: settingsUid,
          record: {
            uid: settingsUid,
            settings,
            updatedAt: new Date().toISOString()
          } satisfies ObservabilitySettingsRecord
        }
      )
      .collect(), databaseTimeoutMs, 'Observability database write timed out')
    await closeQuietly(db)
    return true
  } catch (error) {
    markDatabaseUnavailable()
    recordDbFallback('observability')
    await closeQuietly(db)
    console.warn('[observability-store] Database write failed, falling back to file store:', error)
    return false
  }
}

async function checkService(
  id: GrafanaServiceId,
  label: string,
  displayUrl: string,
  healthUrl: string,
  checkedAt: string,
  auth = false
): Promise<GrafanaServiceHealth> {
  try {
    const response = await fetch(healthUrl, {
      headers: auth ? await grafanaHeaders() : undefined,
      signal: AbortSignal.timeout(1_750)
    })

    return {
      id,
      label,
      url: displayUrl,
      status: response.ok ? 'connected' : 'degraded',
      checkedAt,
      error: response.ok ? undefined : `HTTP ${response.status}`
    }
  } catch (error) {
    return {
      id,
      label,
      url: displayUrl,
      status: 'degraded',
      checkedAt,
      error: errorMessage(error)
    }
  }
}

function serviceChecksFor(settings: GrafanaSettings): GrafanaServiceCheck[] {
  const grafanaBase = serverUrlFor(settings.baseUrl)
  const grafanaHealth = new URL('/api/health', ensureTrailingSlash(grafanaBase)).toString()
  const localOnly = settings.mode !== 'local'

  return [
    {
      id: 'grafana' as const,
      label: 'Grafana',
      displayUrl: settings.baseUrl,
      healthUrl: grafanaHealth,
      disabled: false,
      auth: settings.mode === 'external'
    },
    localService('loki', 'Loki', numberFromEnv('LOKI_PORT', 3100), '/ready', localOnly),
    localService('tempo', 'Tempo', numberFromEnv('TEMPO_PORT', 3200), '/ready', localOnly),
    localService('prometheus', 'Prometheus', numberFromEnv('PROMETHEUS_PORT', 9090), '/-/ready', localOnly),
    localService('alloy', 'Alloy', numberFromEnv('ALLOY_PORT', 12345), '/-/ready', localOnly)
  ]
}

function localService(
  id: Exclude<GrafanaServiceId, 'grafana'>,
  label: string,
  port: number,
  path: string,
  disabled: boolean
) {
  return {
    id,
    label,
    displayUrl: `http://localhost:${port}`,
    healthUrl: `http://127.0.0.1:${port}${path}`,
    disabled,
    auth: false
  }
}

async function grafanaHeaders() {
  const token = await resolveGrafanaToken()
  return token
    ? {
        Authorization: `Bearer ${token}`
      }
    : undefined
}

async function resolveGrafanaToken() {
  const secret = await getProviderSecret(providerId, tokenSecretKey)
  return secret || process.env.BUILDER_GRAFANA_TOKEN || ''
}

async function grafanaTokenStatus(): Promise<GrafanaTokenStatus> {
  const stored = await providerSecretStatus(providerId, tokenSecretKey)
  if (stored.configured) {
    return stored
  }

  const envToken = process.env.BUILDER_GRAFANA_TOKEN || ''
  if (envToken) {
    return {
      configured: true,
      source: 'env',
      storeReady: stored.storeReady,
      fingerprint: fingerprintSecret(envToken)
    }
  }

  return stored
}

function normalizeSettings(settings: GrafanaSettings): GrafanaSettings {
  const defaults = defaultGrafanaSettings()
  const mode = normalizeMode(settings.mode) || defaults.mode
  const baseUrl = optionalUrl(settings.baseUrl) || defaults.baseUrl
  const embedBaseUrl = optionalUrl(settings.embedBaseUrl) || baseUrl
  const currentSlots = Array.isArray(settings.slots) ? settings.slots : []
  const slots = defaults.slots.map((defaultSlotItem) => {
    return normalizeSlot(
      currentSlots.find((slot) => slot.id === defaultSlotItem.id) || defaultSlotItem,
      defaultSlotItem
    )
  })

  return {
    version: 1,
    mode,
    baseUrl,
    embedBaseUrl,
    defaultFrom: optionalRange(settings.defaultFrom) || defaults.defaultFrom,
    defaultTo: optionalRange(settings.defaultTo) || defaults.defaultTo,
    slots,
    updatedAt: settings.updatedAt
  }
}

function normalizeSlot(slot: Partial<GrafanaDashboardSlot>, fallback: GrafanaDashboardSlot): GrafanaDashboardSlot {
  const dashboardTitle = optionalString(slot.dashboardTitle)
  const label = optionalString(slot.label) || dashboardTitle || fallback.label
  return {
    id: fallback.id,
    order: fallback.order,
    label,
    icon: optionalString(slot.icon) || fallback.icon,
    dashboardUid: optionalString(slot.dashboardUid),
    dashboardSlug: optionalString(slot.dashboardSlug) || slugify(dashboardTitle || label),
    dashboardTitle,
    panelId: optionalString(slot.panelId),
    from: optionalRange(slot.from) || fallback.from,
    to: optionalRange(slot.to) || fallback.to,
    enabled: slot.enabled === undefined ? fallback.enabled : Boolean(slot.enabled)
  }
}

function defaultSlot(
  id: string,
  order: number,
  label: string,
  icon: string,
  dashboardUid: string,
  dashboardTitle: string
): GrafanaDashboardSlot {
  return {
    id,
    order,
    label,
    icon,
    dashboardUid,
    dashboardSlug: slugify(dashboardTitle),
    dashboardTitle,
    from: 'now-6h',
    to: 'now',
    enabled: true
  }
}

function normalizeDashboardResult(result: GrafanaSearchResult, baseUrl: string): GrafanaDashboardRef {
  const title = result.title || result.uid || 'Dashboard'
  const slug = slugFromGrafanaUrl(result.url) || slugify(title)
  const url = result.url
    ? new URL(result.url, ensureTrailingSlash(baseUrl)).toString()
    : new URL(`/d/${result.uid}/${slug}`, ensureTrailingSlash(baseUrl)).toString()

  return {
    uid: result.uid || '',
    title,
    slug,
    url,
    folderTitle: result.folderTitle,
    tags: result.tags || [],
    source: 'grafana'
  }
}

function filterStarterDashboards(query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return starterDashboards
  }

  return starterDashboards.filter((dashboard) => {
    return [dashboard.title, dashboard.uid, dashboard.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  })
}

function dashboardRef(uid: string, title: string): GrafanaDashboardRef {
  const slug = slugify(title)
  return {
    uid,
    title,
    slug,
    url: `/d/${uid}/${slug}`,
    folderTitle: 'Builder',
    tags: ['builder'],
    source: 'provisioned'
  }
}

async function connectDatabase(db: Surreal, config: SurrealConfig) {
  await db.connect(config.url, {
    authentication: config.username && config.password
      ? {
          username: config.username,
          password: config.password
        }
      : undefined
  })

  await db.use({
    namespace: config.namespace,
    database: config.database
  })
}

async function closeQuietly(db: Surreal) {
  try {
    if (db.isConnected) {
      await db.close()
    }
  } catch {
    // Nothing useful to do during fallback.
  }
}

function surrealConfigFromEnv(): SurrealConfig {
  return {
    url: process.env.SURREALDB_URL || '',
    namespace: process.env.SURREALDB_NAMESPACE || 'builder',
    database: process.env.SURREALDB_DATABASE || 'inventory',
    username: process.env.SURREALDB_USERNAME || '',
    password: process.env.SURREALDB_PASSWORD || ''
  }
}

function canUseDatabase() {
  return Date.now() >= databaseUnavailableUntil
}

function markDatabaseUnavailable() {
  databaseUnavailableUntil = Date.now() + databaseBackoffMs
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function serverUrlFor(value: string) {
  return value
    .replace('http://localhost:', 'http://127.0.0.1:')
    .replace('http://[::1]:', 'http://127.0.0.1:')
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

function optionalUrl(value?: string) {
  const trimmed = optionalString(value)
  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed)
    return url.toString().replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

function optionalRange(value?: string) {
  const trimmed = optionalString(value)
  if (!trimmed) {
    return undefined
  }

  return /^[a-z0-9:_./+-]+$/i.test(trimmed) ? trimmed : undefined
}

function normalizeMode(value?: string): GrafanaMode | undefined {
  return value === 'local' || value === 'external' ? value : undefined
}

function optionalString(value?: string) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function slugify(value?: string) {
  return (value || 'dashboard')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'dashboard'
}

function slugFromGrafanaUrl(value?: string) {
  if (!value) {
    return undefined
  }

  const parts = value.split('/').filter(Boolean)
  return parts[0] === 'd' && parts[2] ? parts[2] : undefined
}

function fingerprintSecret(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function numberFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    if ('statusMessage' in error && typeof error.statusMessage === 'string') {
      return error.statusMessage
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
  }

  return String(error)
}

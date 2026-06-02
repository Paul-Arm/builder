export type GrafanaMode = 'local' | 'external'
export type GrafanaServiceId = 'grafana' | 'loki' | 'tempo' | 'prometheus' | 'alloy'
export type GrafanaServiceStatus = 'connected' | 'degraded' | 'disabled'

export interface GrafanaDashboardSlot {
  id: string
  order: number
  label: string
  icon: string
  dashboardUid?: string
  dashboardSlug?: string
  dashboardTitle?: string
  panelId?: string
  from: string
  to: string
  enabled: boolean
}

export interface GrafanaDashboardSlotView extends GrafanaDashboardSlot {
  grafanaUrl?: string
  embedUrl?: string
}

export interface GrafanaSettings {
  version: 1
  mode: GrafanaMode
  baseUrl: string
  embedBaseUrl: string
  defaultFrom: string
  defaultTo: string
  slots: GrafanaDashboardSlot[]
  updatedAt?: string
}

export interface GrafanaServiceHealth {
  id: GrafanaServiceId
  label: string
  url: string
  status: GrafanaServiceStatus
  checkedAt: string
  error?: string
}

export interface GrafanaTokenStatus {
  configured: boolean
  source: 'database' | 'file' | 'env' | 'missing'
  storeReady: boolean
  fingerprint?: string
  updatedAt?: string
}

export interface GrafanaConnectionStatus {
  configured: boolean
  mode: GrafanaMode
  baseUrl: string
  embedBaseUrl: string
  token: GrafanaTokenStatus
  services: GrafanaServiceHealth[]
  checkedAt: string
}

export interface GrafanaDashboardRef {
  uid: string
  title: string
  slug: string
  url: string
  folderTitle?: string
  tags: string[]
  source: 'grafana' | 'provisioned'
}

export interface GrafanaState {
  settings: GrafanaSettings
  status: GrafanaConnectionStatus
  slots: GrafanaDashboardSlotView[]
}

export interface GrafanaAdminLoginResponse {
  authenticated: boolean
  adminUrl: string
  message?: string
}

export interface UpdateGrafanaSettingsRequest {
  mode?: GrafanaMode
  baseUrl?: string
  embedBaseUrl?: string
  defaultFrom?: string
  defaultTo?: string
  slots?: Array<Partial<GrafanaDashboardSlot> & { id: string }>
}

export interface SaveGrafanaTokenRequest {
  token: string
}

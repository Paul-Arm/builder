<script setup lang="ts">
import type {
  GrafanaAdminLoginResponse,
  GrafanaDashboardRef,
  GrafanaDashboardSlot,
  GrafanaMode,
  GrafanaState,
  UpdateGrafanaSettingsRequest
} from '~~/types/observability'

const route = useRoute()
const router = useRouter()

const {
  data: grafana,
  pending,
  error,
  refresh
} = useFetch<GrafanaState>('/api/observability/grafana', {
  lazy: true,
  server: false
})

const dashboardQuery = ref('')
const dashboardResults = ref<GrafanaDashboardRef[]>([])
const selectedSlotId = ref(slotIdFromRoute())
const saving = ref(false)
const savingToken = ref(false)
const deletingToken = ref(false)
const searchingDashboards = ref(false)
const clientReady = ref(false)
const message = ref('')
const tokenDraft = ref('')
const adminFrameUrl = ref('')
const adminFrameKey = ref(0)
const adminLoginStatus = ref<'idle' | 'loading' | 'connected' | 'degraded' | 'disabled'>('idle')
const adminLoginMessage = ref('')

const settingsDraft = reactive({
  mode: 'local' as GrafanaMode,
  baseUrl: '',
  embedBaseUrl: '',
  defaultFrom: 'now-6h',
  defaultTo: 'now'
})
const slotsDraft = ref<GrafanaDashboardSlot[]>([])

const modeItems = computed(() => [
  { label: 'Local', value: 'local' },
  { label: 'External', value: 'external' }
])

const dashboardItems = computed(() => {
  return dashboardResults.value.map((dashboard) => ({
    label: dashboard.folderTitle ? `${dashboard.title} / ${dashboard.folderTitle}` : dashboard.title,
    value: dashboard.uid
  }))
})

const selectedSlot = computed(() => {
  return slotsDraft.value.find((slot) => slot.id === selectedSlotId.value) || slotsDraft.value[0]
})

const selectedSlotView = computed(() => {
  return grafana.value?.slots.find((slot) => slot.id === selectedSlotId.value)
})

const selectedPreviewUrl = computed(() => {
  return selectedSlotView.value?.embedUrl || selectedSlotView.value?.grafanaUrl
})

const selectedGrafanaUrl = computed(() => selectedSlotView.value?.grafanaUrl)

const isAdminView = computed(() => !route.query.slot)

const adminStatus = computed(() => {
  if (adminLoginStatus.value === 'connected' || adminLoginStatus.value === 'disabled') {
    return adminLoginStatus.value
  }

  return 'degraded'
})

watch(grafana, (state) => {
  if (!state) {
    return
  }

  settingsDraft.mode = state.settings.mode
  settingsDraft.baseUrl = state.settings.baseUrl
  settingsDraft.embedBaseUrl = state.settings.embedBaseUrl
  settingsDraft.defaultFrom = state.settings.defaultFrom
  settingsDraft.defaultTo = state.settings.defaultTo
  slotsDraft.value = state.settings.slots.map((slot) => ({ ...slot }))

  if (!slotsDraft.value.some((slot) => slot.id === selectedSlotId.value)) {
    selectedSlotId.value = slotsDraft.value[0]?.id || 'slot-1'
  }

  if (clientReady.value && isAdminView.value) {
    void ensureAdminGrafana()
  }
}, { immediate: true })

watch(() => route.query.slot, () => {
  selectedSlotId.value = slotIdFromRoute()
  if (clientReady.value && isAdminView.value) {
    void ensureAdminGrafana(true)
  }
})

watch(settingsDraft, () => {
  message.value = ''
}, { deep: true })

onMounted(() => {
  clientReady.value = true
  void searchDashboards()
  if (isAdminView.value) {
    void ensureAdminGrafana()
  }
})

async function refreshAll() {
  message.value = ''
  await Promise.all([refresh(), searchDashboards()])
}

async function ensureAdminGrafana(force = false) {
  if (!grafana.value || adminLoginStatus.value === 'loading') {
    return
  }

  if (!force && adminFrameUrl.value && adminLoginStatus.value === 'connected') {
    return
  }

  adminLoginMessage.value = ''

  if (settingsDraft.mode !== 'local') {
    adminLoginStatus.value = 'disabled'
    adminFrameUrl.value = browserGrafanaUrl(settingsDraft.baseUrl)
    adminFrameKey.value += 1
    adminLoginMessage.value = 'External Grafana requires manual login'
    return
  }

  adminLoginStatus.value = 'loading'

  try {
    const result = await $fetch<GrafanaAdminLoginResponse>('/api/observability/grafana/admin-login', {
      method: 'POST'
    })
    adminFrameUrl.value = result.adminUrl
    adminFrameKey.value += 1
    adminLoginStatus.value = result.authenticated ? 'connected' : 'disabled'
    adminLoginMessage.value = result.message || ''
  } catch (error) {
    adminLoginStatus.value = 'degraded'
    adminFrameUrl.value = browserGrafanaUrl(settingsDraft.baseUrl)
    adminFrameKey.value += 1
    adminLoginMessage.value = errorMessage(error)
  }
}

async function searchDashboards() {
  searchingDashboards.value = true

  try {
    dashboardResults.value = await $fetch<GrafanaDashboardRef[]>('/api/observability/grafana/dashboards', {
      query: {
        query: dashboardQuery.value
      }
    })
  } finally {
    searchingDashboards.value = false
  }
}

async function saveSettings() {
  saving.value = true
  message.value = ''

  try {
    grafana.value = await $fetch<GrafanaState>('/api/observability/grafana', {
      method: 'PATCH',
      body: {
        mode: settingsDraft.mode,
        baseUrl: settingsDraft.baseUrl,
        embedBaseUrl: settingsDraft.embedBaseUrl,
        defaultFrom: settingsDraft.defaultFrom,
        defaultTo: settingsDraft.defaultTo,
        slots: slotsDraft.value
      } satisfies UpdateGrafanaSettingsRequest
    })
    message.value = 'Grafana settings saved'
    await searchDashboards()
  } finally {
    saving.value = false
  }
}

async function saveToken() {
  savingToken.value = true
  message.value = ''

  try {
    grafana.value = await $fetch<GrafanaState>('/api/observability/grafana/token', {
      method: 'POST',
      body: {
        token: tokenDraft.value
      }
    })
    tokenDraft.value = ''
    message.value = 'Grafana token saved'
    await searchDashboards()
  } finally {
    savingToken.value = false
  }
}

async function deleteToken() {
  deletingToken.value = true
  message.value = ''

  try {
    grafana.value = await $fetch<GrafanaState>('/api/observability/grafana/token', {
      method: 'DELETE'
    })
    message.value = 'Grafana token removed'
  } finally {
    deletingToken.value = false
  }
}

function assignDashboard(slot: GrafanaDashboardSlot, dashboardUid: string) {
  const dashboard = dashboardResults.value.find((item) => item.uid === dashboardUid)
  slot.dashboardUid = dashboardUid
  slot.dashboardTitle = dashboard?.title || slot.dashboardTitle
  slot.dashboardSlug = dashboard?.slug || slugify(slot.dashboardTitle || slot.label)
  if (!slot.label || slot.label.startsWith('Dashboard ')) {
    slot.label = dashboard?.title || slot.label
  }
}

function selectSlot(slotId: string) {
  selectedSlotId.value = slotId
  router.replace({
    query: {
      ...route.query,
      slot: slotId
    }
  })
}

function slotIdFromRoute() {
  const slot = route.query.slot
  return typeof slot === 'string' && /^slot-[1-5]$/.test(slot) ? slot : 'slot-1'
}

function formatDate(value?: string) {
  if (!value) {
    return 'n/a'
  }

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

function slugify(value?: string) {
  return (value || 'dashboard')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'dashboard'
}

function browserGrafanaUrl(value: string) {
  try {
    const url = new URL(value)
    if (import.meta.client && isLoopbackHost(url.hostname)) {
      url.hostname = window.location.hostname
    }
    url.pathname = '/'
    url.search = 'orgId=1'
    return url.toString()
  } catch {
    return value
  }
}

function isLoopbackHost(value: string) {
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]'
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

  return 'Grafana admin login failed'
}
</script>

<template>
  <main class="app-frame">
    <AppRail mode="mixed" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Observability</p>
          <h1>{{ isAdminView ? 'Grafana Admin' : 'Grafana' }}</h1>
        </div>

        <div v-if="isAdminView" class="topbar-actions">
          <StatusPill :status="adminStatus" />
          <UButton
            icon="i-lucide-log-in"
            color="neutral"
            variant="outline"
            :loading="adminLoginStatus === 'loading'"
            @click="ensureAdminGrafana(true)"
          >
            Auto login
          </UButton>
          <UButton
            v-if="adminFrameUrl"
            icon="i-lucide-external-link"
            color="primary"
            :to="adminFrameUrl"
            target="_blank"
          >
            Open
          </UButton>
        </div>

        <div v-else class="topbar-actions">
          <UInput
            v-model="dashboardQuery"
            icon="i-lucide-search"
            placeholder="Dashboard suchen"
            class="w-full sm:w-72"
            size="md"
            @keydown.enter="searchDashboards"
          />
          <UButton
            icon="i-lucide-search"
            color="neutral"
            variant="outline"
            :loading="searchingDashboards"
            @click="searchDashboards"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            title="Refresh Grafana"
            @click="refreshAll"
          />
          <UButton
            icon="i-lucide-save"
            color="primary"
            :loading="saving"
            @click="saveSettings"
          >
            Save
          </UButton>
        </div>
      </header>

      <div v-if="!clientReady || pending" class="empty-state">Grafana wird geladen</div>
      <div v-else-if="error" class="empty-state danger">Grafana API nicht erreichbar</div>

      <section v-else-if="grafana && isAdminView" class="grafana-admin-console">
        <section class="grafana-admin-panel">
          <div class="grafana-preview-toolbar">
            <div>
              <p class="eyebrow">Admin</p>
              <h2>{{ settingsDraft.mode === 'local' ? 'Local Grafana' : 'External Grafana' }}</h2>
              <small v-if="adminLoginMessage" class="muted">{{ adminLoginMessage }}</small>
            </div>
            <StatusPill :status="adminStatus" />
          </div>

          <iframe
            v-if="adminFrameUrl"
            :key="adminFrameKey"
            class="grafana-admin-frame"
            :src="adminFrameUrl"
            title="Grafana admin"
          />
          <div v-else class="empty-state">
            Grafana Admin wird geladen
          </div>
        </section>
      </section>

      <section v-else-if="grafana" class="grafana-console">
        <section class="grafana-health-row">
          <article
            v-for="service in grafana.status.services"
            :key="service.id"
            class="grafana-health-card"
            :data-status="service.status"
          >
            <div>
              <span>{{ service.label }}</span>
              <strong>{{ service.url }}</strong>
              <small>{{ service.error || formatDate(service.checkedAt) }}</small>
            </div>
            <StatusPill :status="service.status" />
          </article>
        </section>

        <aside class="grafana-settings-column">
          <section class="collector-page-panel grafana-form-panel">
            <div class="panel-heading">
              <h2>Settings</h2>
              <StatusPill :status="grafana.status.configured ? 'connected' : 'degraded'" />
            </div>

            <div class="grafana-form-grid">
              <label>
                <span>Mode</span>
                <USelect
                  v-model="settingsDraft.mode"
                  :items="modeItems"
                  value-key="value"
                  label-key="label"
                  size="sm"
                />
              </label>
              <label>
                <span>Grafana URL</span>
                <UInput v-model="settingsDraft.baseUrl" size="sm" />
              </label>
              <label>
                <span>Embed URL</span>
                <UInput v-model="settingsDraft.embedBaseUrl" size="sm" />
              </label>
              <div class="project-form-row">
                <label>
                  <span>From</span>
                  <UInput v-model="settingsDraft.defaultFrom" size="sm" />
                </label>
                <label>
                  <span>To</span>
                  <UInput v-model="settingsDraft.defaultTo" size="sm" />
                </label>
              </div>
            </div>
          </section>

          <section v-if="settingsDraft.mode === 'external'" class="collector-page-panel grafana-form-panel">
            <div class="panel-heading">
              <h2>External token</h2>
              <StatusPill :status="grafana.status.token.configured ? 'connected' : 'disabled'" />
            </div>

            <div class="github-connection-card">
              <div class="github-connection-main">
                <div class="collector-card-icon">
                  <UIcon name="i-lucide-key-round" class="size-5" />
                </div>
                <div>
                  <strong>{{ grafana.status.token.source }}</strong>
                  <small>{{ grafana.status.token.fingerprint || 'no token' }}</small>
                </div>
              </div>
            </div>

            <form class="github-token-form" @submit.prevent="saveToken">
              <UInput
                v-model="tokenDraft"
                type="password"
                icon="i-lucide-lock-keyhole"
                placeholder="Grafana API token"
                autocomplete="off"
                size="sm"
              />
              <UButton
                type="submit"
                icon="i-lucide-save"
                color="primary"
                size="sm"
                :loading="savingToken"
                :disabled="!tokenDraft"
              >
                Save
              </UButton>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                :loading="deletingToken"
                :disabled="grafana.status.token.source !== 'database' && grafana.status.token.source !== 'file'"
                @click="deleteToken"
              />
            </form>

            <p v-if="message" class="muted">{{ message }}</p>
          </section>
        </aside>

        <section class="grafana-preview-panel">
          <div class="grafana-slot-tabs">
            <button
              v-for="slot in slotsDraft"
              :key="slot.id"
              type="button"
              :class="{ selected: selectedSlotId === slot.id }"
              @click="selectSlot(slot.id)"
            >
              <UIcon :name="slot.icon || 'i-lucide-layout-dashboard'" />
              <span>{{ slot.label }}</span>
            </button>
          </div>

          <div class="grafana-preview-toolbar">
            <div>
              <p class="eyebrow">Preview</p>
              <h2>{{ selectedSlot?.dashboardTitle || selectedSlot?.label || 'Dashboard' }}</h2>
            </div>
            <UButton
              v-if="selectedGrafanaUrl"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
              :to="selectedGrafanaUrl"
              target="_blank"
            >
              Open
            </UButton>
          </div>

          <iframe
            v-if="selectedPreviewUrl"
            class="grafana-preview-frame"
            :src="selectedPreviewUrl"
            title="Grafana dashboard preview"
          />
          <div v-else class="empty-state">
            Dashboard Slot ist leer
          </div>
        </section>

        <aside class="grafana-slot-panel collector-page-panel">
          <div class="panel-heading">
            <h2>Dashboard slots</h2>
            <span>{{ slotsDraft.length }}</span>
          </div>

          <div class="grafana-slot-list">
            <article
              v-for="slot in slotsDraft"
              :key="slot.id"
              class="grafana-slot-editor"
              :class="{ selected: selectedSlotId === slot.id }"
            >
              <button
                type="button"
                class="grafana-slot-editor-head"
                @click="selectSlot(slot.id)"
              >
                <span class="collector-card-icon">
                  <UIcon :name="slot.icon || 'i-lucide-layout-dashboard'" />
                </span>
                <span class="provider-card-main">
                  <strong>{{ slot.label || slot.id }}</strong>
                  <small>{{ slot.dashboardUid || 'empty' }} / {{ slot.from }} - {{ slot.to }}</small>
                </span>
                <StatusPill :status="slot.enabled ? 'connected' : 'disabled'" />
              </button>

              <div class="grafana-slot-fields">
                <div class="project-form-row">
                  <UInput v-model="slot.label" placeholder="Label" size="sm" />
                  <UInput v-model="slot.icon" placeholder="i-lucide-chart-line" size="sm" />
                </div>
                <USelect
                  :model-value="slot.dashboardUid"
                  :items="dashboardItems"
                  value-key="value"
                  label-key="label"
                  placeholder="Dashboard"
                  size="sm"
                  @update:model-value="assignDashboard(slot, String($event))"
                />
                <div class="project-form-row">
                  <UInput v-model="slot.panelId" placeholder="Panel ID" size="sm" />
                  <UCheckbox v-model="slot.enabled" label="Enabled" />
                </div>
                <div class="project-form-row">
                  <UInput v-model="slot.from" placeholder="now-6h" size="sm" />
                  <UInput v-model="slot.to" placeholder="now" size="sm" />
                </div>
              </div>
            </article>
          </div>
        </aside>
      </section>
    </section>
  </main>
</template>

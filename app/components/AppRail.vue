<script setup lang="ts">
import type { GrafanaState } from '~~/types/observability'

const props = defineProps<{
  mode?: string
  collectorCount?: number
}>()

const route = useRoute()
const open = ref(true)
const { data: grafana } = useFetch<GrafanaState>('/api/observability/grafana', {
  lazy: true,
  server: false
})

const collapsed = computed(() => !open.value)

const mainNavigationItems = computed(() => [
  {
    label: 'Graph',
    to: '/',
    icon: 'i-lucide-boxes',
    active: isActive('/'),
    tooltip: true
  },
  {
    label: 'Dashboard 2',
    to: '/dashboard-2',
    icon: 'i-lucide-git-fork',
    active: isActive('/dashboard-2'),
    tooltip: true
  },
  {
    label: 'Projects',
    to: '/projects',
    icon: 'i-lucide-folder-kanban',
    active: isActive('/projects'),
    tooltip: true
  },
  {
    label: 'Providers',
    to: '/collectors',
    icon: 'i-lucide-server',
    active: isActive('/collectors'),
    badge: props.collectorCount,
    tooltip: true
  },
  {
    label: 'IaC',
    to: '/iac',
    icon: 'i-lucide-braces',
    active: isActive('/iac'),
    tooltip: true
  },
  {
    label: 'Targets',
    to: '/targets',
    icon: 'i-lucide-crosshair',
    active: isActive('/targets'),
    tooltip: true
  },
  {
    label: 'Grafana',
    to: '/grafana',
    icon: 'i-lucide-chart-no-axes-combined',
    active: isActive('/grafana') && !route.query.slot,
    tooltip: true
  }
])

const grafanaSlotItems = computed(() => {
  const slots = grafana.value?.slots || []
  return Array.from({ length: 5 }, (_, index) => {
    const id = `slot-${index + 1}`
    const slot = slots.find((item) => item.id === id)
    return {
      label: slot?.label || `Dashboard ${index + 1}`,
      to: `/grafana?slot=${id}`,
      icon: slot?.icon || 'i-lucide-layout-dashboard',
      active: route.path === '/grafana' && route.query.slot === id,
      tooltip: true
    }
  })
})

const sidebarUi = {
  root: '[--sidebar-width:17rem] [--sidebar-width-icon:4.5rem]',
  container: 'z-30',
  inner: 'app-sidebar-inner',
  header: 'app-sidebar-header',
  body: 'app-sidebar-body',
  footer: 'app-sidebar-footer'
}

const navUi = {
  root: 'sidebar-nav-root',
  list: 'sidebar-nav-list',
  link: 'sidebar-nav-link',
  linkLeadingIcon: 'sidebar-nav-icon',
  linkLabel: 'sidebar-nav-label',
  linkTrailing: 'sidebar-nav-trailing'
}

function isActive(path: string) {
  return path === '/' ? route.path === '/' : route.path.startsWith(path)
}
</script>

<template>
  <UButton
    class="mobile-sidebar-trigger"
    icon="i-lucide-panel-left-open"
    color="neutral"
    variant="solid"
    size="sm"
    aria-label="Navigation öffnen"
    title="Navigation öffnen"
    @click="open = true"
  />

  <USidebar
    v-model:open="open"
    collapsible="icon"
    side="left"
    variant="sidebar"
    mode="slideover"
    :ui="sidebarUi"
    class="app-sidebar"
  >
    <template #header="{ state }">
      <div class="sidebar-header-content" :data-state="state">
        <NuxtLink
          v-if="state !== 'collapsed'"
          to="/"
          class="sidebar-brand"
          aria-label="Builder Graph öffnen"
        >
          <span class="sidebar-brand-mark">
            <UIcon name="i-lucide-boxes" />
          </span>
          <span class="sidebar-brand-copy">
            <strong>Builder</strong>
            <small>Environment Graph</small>
          </span>
        </NuxtLink>

        <UTooltip :text="collapsed ? 'Sidebar öffnen' : 'Sidebar einklappen'">
          <UButton
            :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-expanded="!collapsed"
            :aria-label="collapsed ? 'Sidebar öffnen' : 'Sidebar einklappen'"
            :title="collapsed ? 'Sidebar öffnen' : 'Sidebar einklappen'"
            @click="open = !open"
          />
        </UTooltip>
      </div>
    </template>

    <UNavigationMenu
      :items="mainNavigationItems"
      orientation="vertical"
      :collapsed="collapsed"
      tooltip
      color="primary"
      variant="pill"
      :ui="navUi"
    />

    <section class="sidebar-nav-group" :data-state="collapsed ? 'collapsed' : 'expanded'">
      <UTooltip text="Grafana Dashboards">
        <div class="sidebar-nav-group-label">
          <UIcon name="i-lucide-layout-dashboard" />
          <span v-if="!collapsed">Dashboards</span>
        </div>
      </UTooltip>

      <UNavigationMenu
        :items="grafanaSlotItems"
        orientation="vertical"
        :collapsed="collapsed"
        tooltip
        color="primary"
        variant="pill"
        :ui="navUi"
      />
    </section>

    <template #footer="{ state }">
      <UTooltip :text="mode === 'mixed' ? 'Mixed inventory mode' : 'Inventory mode'">
        <div class="sidebar-status" :data-state="state">
          <UIcon name="i-lucide-activity" />
          <span v-if="state !== 'collapsed'">Inventory</span>
          <StatusPill v-if="state !== 'collapsed'" :status="mode || 'mixed'" />
        </div>
      </UTooltip>
    </template>
  </USidebar>
</template>

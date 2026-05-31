<script setup lang="ts">
const props = defineProps<{
  mode?: string
  collectorCount?: number
}>()

const route = useRoute()
const open = ref(true)

const collapsed = computed(() => !open.value)

const navigationItems = computed(() => [
  {
    label: 'Graph',
    to: '/',
    icon: 'i-lucide-boxes',
    active: isActive('/'),
    tooltip: true
  },
  {
    label: 'Collectors',
    to: '/collectors',
    icon: 'i-lucide-server',
    active: isActive('/collectors'),
    badge: props.collectorCount,
    tooltip: true
  }
])

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
      :items="navigationItems"
      orientation="vertical"
      :collapsed="collapsed"
      tooltip
      color="primary"
      variant="pill"
      :ui="navUi"
    />

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

<script setup lang="ts">
const props = defineProps<{
  status: string
}>()

const normalized = computed(() => props.status.replace('_', ' '))

const color = computed(() => {
  if (['healthy', 'connected', 'active', 'read_only', 'write_capable', 'completed'].includes(props.status)) {
    return 'success'
  }

  if (['degraded', 'rolling', 'disabled', 'paused'].includes(props.status)) {
    return 'warning'
  }

  if (['failed', 'offline', 'critical'].includes(props.status)) {
    return 'error'
  }

  return 'neutral'
})
</script>

<template>
  <UBadge
    class="capitalize"
    :color="color"
    variant="soft"
    size="sm"
  >
    {{ normalized }}
  </UBadge>
</template>

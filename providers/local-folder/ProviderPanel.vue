<script setup lang="ts">
import type {
  ProviderAddOption,
  ProviderCollectorInstance,
  ProviderManifest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type {
  LocalFolderPreview,
  LocalFolderPreviewEntry
} from './types'

interface BrowserFile {
  size: number
  lastModified: number
}

interface BrowserFileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<BrowserFile>
}

interface BrowserDirectoryHandle {
  kind: 'directory'
  name: string
  values: () => AsyncIterable<BrowserFileHandle | BrowserDirectoryHandle>
}

const props = defineProps<{
  provider: ProviderManifest
  collectors: ProviderCollectorInstance[]
  observations: ProviderObservation[]
  targets: ProviderTargetScope[]
}>()

defineEmits<{
  refresh: []
}>()

const selectedAddOptionId = ref('')
const preview = ref<LocalFolderPreview>()
const previewError = ref('')
const previewPending = ref(false)

const selectedAddOptions = computed(() => props.provider.addOptions)
const selectedAddOption = computed(() => {
  return selectedAddOptions.value.find((option) => option.id === selectedAddOptionId.value)
    || selectedAddOptions.value[0]
})

const folderObservation = computed(() => {
  return props.observations.find((observation) => observation.kind === 'folder')
})

const configuredRoot = computed(() => {
  const payloadRoot = folderObservation.value?.payload.root
  if (typeof payloadRoot === 'string') {
    return payloadRoot
  }

  for (const collector of props.collectors) {
    const root = collector.config.root
    if (typeof root === 'string') {
      return root
    }
  }

  return ''
})

const folderMenuItems = computed(() => [
  [
    {
      label: 'Configured workspace',
      description: configuredRoot.value || 'Provider root',
      icon: 'i-lucide-hard-drive',
      disabled: !configuredRoot.value,
      onSelect: () => loadConfiguredPreview()
    },
    {
      label: 'Choose local folder',
      description: 'Browser folder picker',
      icon: 'i-lucide-folder-open',
      onSelect: () => chooseBrowserFolder()
    }
  ]
])

const previewTitle = computed(() => {
  if (!preview.value) {
    return 'No folder selected'
  }

  return preview.value.rootLabel
})

const previewSubtitle = computed(() => {
  if (!preview.value) {
    return 'Choose a folder to inspect its top-level files.'
  }

  if (preview.value.rootPath) {
    return preview.value.rootPath
  }

  return `${preview.value.source} preview`
})

watch(() => props.provider.id, () => {
  selectedAddOptionId.value = props.provider.addOptions[0]?.id || ''
}, { immediate: true })

onMounted(() => {
  if (configuredRoot.value) {
    void loadConfiguredPreview()
  }
})

function selectAddOption(option: ProviderAddOption) {
  selectedAddOptionId.value = option.id
}

async function loadConfiguredPreview() {
  if (!configuredRoot.value) {
    return
  }

  previewPending.value = true
  previewError.value = ''

  try {
    preview.value = await $fetch<LocalFolderPreview>('/api/providers/local-folder/preview', {
      method: 'POST',
      body: {
        path: configuredRoot.value
      }
    })
  } catch (error) {
    previewError.value = errorMessage(error)
  } finally {
    previewPending.value = false
  }
}

async function chooseBrowserFolder() {
  previewPending.value = true
  previewError.value = ''

  try {
    const picker = (window as typeof window & {
      showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>
    }).showDirectoryPicker

    if (!picker) {
      previewError.value = 'Folder picker is not available in this browser.'
      return
    }

    const directory = await picker()
    preview.value = await previewBrowserDirectory(directory)
  } catch (error) {
    previewError.value = errorMessage(error)
  } finally {
    previewPending.value = false
  }
}

async function previewBrowserDirectory(directory: BrowserDirectoryHandle): Promise<LocalFolderPreview> {
  const maxEntries = 80
  const entries: LocalFolderPreviewEntry[] = []
  let fileCount = 0
  let directoryCount = 0
  let truncated = false

  for await (const item of directory.values()) {
    if (item.name.startsWith('.')) {
      continue
    }

    if (item.kind === 'directory') {
      directoryCount += 1
    } else {
      fileCount += 1
    }

    if (entries.length >= maxEntries) {
      truncated = true
      continue
    }

    if (item.kind === 'directory') {
      entries.push({
        name: item.name,
        kind: 'directory',
        relativePath: item.name
      })
      continue
    }

    const file = await item.getFile()
    entries.push({
      name: item.name,
      kind: 'file',
      relativePath: item.name,
      size: file.size,
      modifiedAt: new Date(file.lastModified).toISOString()
    })
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })

  return {
    source: 'browser',
    rootLabel: directory.name,
    generatedAt: new Date().toISOString(),
    fileCount,
    directoryCount,
    truncated,
    entries
  }
}

function formatBytes(value?: number) {
  if (typeof value !== 'number') {
    return ''
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value?: string) {
  if (!value) {
    return ''
  }

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }

  return 'Folder preview failed'
}
</script>

<template>
  <section class="collector-page-panel provider-extension-panel">
    <div class="panel-heading">
      <h2>Local Folder</h2>
      <span>{{ selectedAddOptions.length }}</span>
    </div>

    <div class="provider-extension-actions">
      <button
        v-for="option in selectedAddOptions"
        :key="option.id"
        type="button"
        class="provider-extension-action"
        :class="{ selected: selectedAddOption?.id === option.id }"
        @click="selectAddOption(option)"
      >
        <strong>{{ option.label }}</strong>
        <span>{{ option.type }}</span>
      </button>
    </div>

    <div class="local-folder-toolbar">
      <UDropdownMenu
        :items="folderMenuItems"
        :content="{ align: 'start' }"
      >
        <UButton
          icon="i-lucide-folder-open"
          trailing-icon="i-lucide-chevron-down"
          color="neutral"
          variant="outline"
          size="sm"
        >
          Folder
        </UButton>
      </UDropdownMenu>

      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="previewPending"
        :disabled="!configuredRoot"
        @click="loadConfiguredPreview"
      />
    </div>

    <div class="local-folder-preview-head">
      <div class="collector-card-icon">
        <UIcon
          name="i-lucide-folder"
          class="size-5"
        />
      </div>
      <div>
        <strong>{{ previewTitle }}</strong>
        <small>{{ previewSubtitle }}</small>
      </div>
    </div>

    <div
      v-if="preview"
      class="local-folder-stats"
    >
      <span>{{ preview.directoryCount }} folders</span>
      <span>{{ preview.fileCount }} files</span>
      <span v-if="preview.truncated">truncated</span>
    </div>

    <p
      v-if="previewError"
      class="muted danger-text"
    >
      {{ previewError }}
    </p>

    <div
      v-if="preview?.entries.length"
      class="local-folder-preview-list"
    >
      <div
        v-for="entry in preview.entries"
        :key="entry.relativePath"
        class="local-folder-entry"
      >
        <UIcon
          :name="entry.kind === 'directory' ? 'i-lucide-folder' : 'i-lucide-file'"
          class="size-4"
        />
        <strong>{{ entry.name }}</strong>
        <span>{{ entry.kind === 'file' ? formatBytes(entry.size) : 'folder' }}</span>
        <small>{{ formatDate(entry.modifiedAt) }}</small>
      </div>
    </div>

    <p
      v-else-if="!previewPending && !previewError"
      class="muted"
    >
      Keine Vorschau geladen.
    </p>
  </section>
</template>

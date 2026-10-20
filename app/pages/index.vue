<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const page = ref(1)
const pageSize = 20

const { data, status } = await useFetch('/api/files', {
  query: { page, pageSize },
  watch: [page],
})

interface FileRow {
  id: number
  path: string
  kind: string
  mime: string
  size: number
  modifiedAt: string
  title: string | null
}

function humanSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const columns: TableColumn<FileRow>[] = [
  { id: 'thumbnail', header: '' },
  { accessorKey: 'path', header: 'Path' },
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'mime', header: 'MIME' },
  { accessorKey: 'size', header: 'Size', cell: ({ row }) => humanSize(row.original.size) },
  { accessorKey: 'modifiedAt', header: 'Modified', cell: ({ row }) => formatDate(row.original.modifiedAt) },
  { accessorKey: 'title', header: 'Title' },
]

const totalPages = computed(() => Math.ceil((data.value?.total ?? 0) / pageSize))
</script>

<template>
  <div class="min-h-screen bg-(--ui-bg)">
    <header class="border-b border-(--ui-border) bg-(--ui-bg-elevated)">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <h1 class="text-xl font-semibold text-(--ui-text-highlighted)">Warehouse</h1>
        <span v-if="data" class="text-sm text-(--ui-text-muted)">
          {{ data.total }} files
        </span>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <UCard>
        <UTable
          :data="data?.rows ?? []"
          :columns="columns"
          :loading="status === 'pending'"
          sticky
        >
          <template #thumbnail-cell="{ row }">
            <img
              v-if="row.original.kind === 'image'"
              :src="`/api/files/${row.original.id}/thumbnail`"
              :alt="row.original.path"
              class="w-10 h-10 object-cover rounded"
              loading="lazy"
            >
            <div v-else class="w-10 h-10 rounded bg-(--ui-bg-accented) flex items-center justify-center">
              <UIcon name="i-lucide-file" class="text-(--ui-text-muted)" />
            </div>
          </template>
        </UTable>

        <template #footer>
          <div class="flex items-center justify-between">
            <span class="text-sm text-(--ui-text-muted)">
              Page {{ page }} of {{ totalPages }}
            </span>
            <UPagination
              v-model:page="page"
              :total="data?.total ?? 0"
              :items-per-page="pageSize"
              :sibling-count="1"
              show-edges
            />
          </div>
        </template>
      </UCard>
    </main>
  </div>
</template>

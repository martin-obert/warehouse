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

const columns: TableColumn<FileRow>[] = [
  { accessorKey: 'path', header: 'Path' },
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'mime', header: 'MIME' },
  { accessorKey: 'size', header: 'Size', cell: ({ row }) => humanSize(row.original.size) },
  { accessorKey: 'modifiedAt', header: 'Modified' },
  { accessorKey: 'title', header: 'Title' },
]
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold mb-4">Files</h1>

    <UTable
      :data="data?.rows ?? []"
      :columns="columns"
      :loading="status === 'pending'"
    />

    <div class="mt-4 flex justify-center">
      <UPagination
        v-model:page="page"
        :total="data?.total ?? 0"
        :items-per-page="pageSize"
        :sibling-count="1"
        show-edges
      />
    </div>
  </div>
</template>

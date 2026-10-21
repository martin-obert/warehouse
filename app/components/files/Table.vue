<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { FileRow } from '~/composables/useFileList'
import { formatDate, humanSize } from '~/utils/file-format'

defineProps<{
  rows: FileRow[]
  loading: boolean
}>()

const emit = defineEmits<{
  select: [file: FileRow]
}>()

const columns: TableColumn<FileRow>[] = [
  { id: 'thumbnail', header: '' },
  { accessorKey: 'path', header: 'Name', cell: ({ row }) => row.original.path.split('/').pop() },
  { accessorKey: 'kind', header: 'Kind' },
  { accessorKey: 'mime', header: 'MIME' },
  { accessorKey: 'size', header: 'Size', cell: ({ row }) => humanSize(row.original.size) },
  { accessorKey: 'modifiedAt', header: 'Modified', cell: ({ row }) => formatDate(row.original.modifiedAt) },
  { accessorKey: 'title', header: 'Title' },
]
</script>

<template>
  <UTable
    :data="rows"
    :columns="columns"
    :loading="loading"
    sticky
    @select="(_e: Event, row: TableRow<FileRow>) => emit('select', row.original)"
  >
    <template #thumbnail-cell="{ row }">
      <FilesThumbnail :file="row.original" />
    </template>
  </UTable>
</template>

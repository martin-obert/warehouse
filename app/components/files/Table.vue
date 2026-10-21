<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { FileRow, ListRow } from '~/composables/useFileList'
import { formatDate, humanSize } from '~/utils/file-format'

defineProps<{
  rows: ListRow[]
  loading: boolean
}>()

const emit = defineEmits<{
  select: [file: FileRow]
}>()

const { navigate } = useCurrentFolder()

function onSelect(_e: Event, row: TableRow<ListRow>) {
  if (row.original.rowType === 'folder') navigate(row.original.path)
  else emit('select', row.original.file)
}

const columns: TableColumn<ListRow>[] = [
  { id: 'thumbnail', header: '' },
  {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => row.original.rowType === 'folder' ? row.original.name : row.original.file.path.split('/').pop(),
  },
  {
    id: 'kind',
    header: 'Kind',
    cell: ({ row }) => row.original.rowType === 'folder' ? 'folder' : row.original.file.kind,
  },
  {
    id: 'mime',
    header: 'MIME',
    cell: ({ row }) => row.original.rowType === 'folder' ? '—' : row.original.file.mime,
  },
  {
    id: 'size',
    header: 'Size',
    cell: ({ row }) => row.original.rowType === 'folder' ? '—' : humanSize(row.original.file.size),
  },
  {
    id: 'modifiedAt',
    header: 'Modified',
    cell: ({ row }) => row.original.rowType === 'folder' ? '—' : formatDate(row.original.file.modifiedAt),
  },
]
</script>

<template>
  <UTable
    :data="rows"
    :columns="columns"
    :loading="loading"
    sticky
    @select="onSelect"
  >
    <template #thumbnail-cell="{ row }">
      <FilesThumbnail v-if="row.original.rowType === 'file'" :file="row.original.file" />
      <div v-else class="w-10 h-10 rounded bg-(--ui-bg-accented) flex items-center justify-center">
        <UIcon name="i-lucide-folder" class="text-(--ui-text-muted)" />
      </div>
    </template>
  </UTable>
</template>

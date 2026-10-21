export interface FileRow {
  id: number
  path: string
  kind: string
  mime: string
  size: number
  modifiedAt: string
  title: string | null
}

export type ListRow =
  | { rowType: 'folder'; name: string; path: string }
  | { rowType: 'file'; file: FileRow }

interface FileListResponse {
  rows: FileRow[]
  total: number
}

export async function useFileList(pageSize = 20) {
  const { path } = useCurrentFolder()
  const page = ref(1)
  watch(path, () => { page.value = 1 })

  const { data, status } = await useAsyncData(
    'file-list',
    async () => {
      const [files, folders] = await Promise.all([
        $fetch<FileListResponse>('/api/files', { query: { path: path.value, page: page.value, pageSize } }),
        $fetch<{ folders: string[] }>('/api/folders', { query: { path: path.value } }),
      ])
      return { files, folders: folders.folders }
    },
    { watch: [path, page] },
  )

  const total = computed(() => data.value?.files.total ?? 0)
  const isLoading = computed(() => status.value === 'pending')

  const rows = computed<ListRow[]>(() => {
    const fileRows: ListRow[] = (data.value?.files.rows ?? []).map((file) => ({ rowType: 'file', file }))
    if (page.value !== 1) return fileRows

    const folderRows: ListRow[] = (data.value?.folders ?? []).map((name) => ({
      rowType: 'folder',
      name,
      path: path.value ? `${path.value}/${name}` : name,
    }))
    return [...folderRows, ...fileRows]
  })

  return { page, pageSize, data, rows, total, isLoading }
}

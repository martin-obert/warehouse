export interface FileRow {
  id: number
  path: string
  kind: string
  mime: string
  size: number
  modifiedAt: string
  title: string | null
}

export async function useFileList(pageSize = 20) {
  const page = ref(1)

  const { data, status } = await useFetch('/api/files', {
    query: { page, pageSize },
    watch: [page],
  })

  const rows = computed<FileRow[]>(() => data.value?.rows ?? [])
  const total = computed(() => data.value?.total ?? 0)
  const isLoading = computed(() => status.value === 'pending')

  return { page, pageSize, data, rows, total, isLoading }
}

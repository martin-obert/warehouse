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
  const { path } = useCurrentFolder()
  const page = ref(1)
  watch(path, () => { page.value = 1 })

  const { data, status } = await useFetch('/api/files', {
    query: { path, page, pageSize },
    watch: [path, page],
  })

  const rows = computed<FileRow[]>(() => data.value?.rows ?? [])
  const total = computed(() => data.value?.total ?? 0)
  const isLoading = computed(() => status.value === 'pending')

  return { page, pageSize, data, rows, total, isLoading }
}

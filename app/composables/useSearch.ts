import type { FileRow } from './useFileList'

export interface SearchHit extends FileRow {
  snippet: string | null
}

export function useSearch(debounceMs = 250) {
  const inputQuery = ref('')
  const debouncedQuery = ref('')
  const hits = ref<SearchHit[]>([])
  const isLoading = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(inputQuery, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => { debouncedQuery.value = value.trim() }, debounceMs)
  })

  const isActive = computed(() => debouncedQuery.value.length > 0)

  watch(debouncedQuery, async (q) => {
    if (!q) {
      hits.value = []
      return
    }
    isLoading.value = true
    try {
      const result = await $fetch('/api/search', { query: { q } })
      hits.value = result.hits
    } finally {
      isLoading.value = false
    }
  })

  return { inputQuery, isActive, hits, isLoading }
}

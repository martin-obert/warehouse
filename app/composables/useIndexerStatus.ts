export function useIndexerStatus(pollIntervalMs = 3000) {
  const status = ref<string>('idle')
  const paused = ref(false)
  const filesIndexed = ref(0)
  const filesTotal = ref(0)
  const error = ref<string | null>(null)

  const isRunning = computed(() => status.value === 'running')
  const isFinished = computed(() => status.value === 'finished')

  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh() {
    try {
      const data = await $fetch<{
        status: string
        paused: boolean
        filesIndexed: number
        filesTotal: number
        error: string | null
      }>('/api/indexer/status')
      status.value = data.status
      paused.value = data.paused
      filesIndexed.value = data.filesIndexed
      filesTotal.value = data.filesTotal
      error.value = data.error
    } catch {
      // Silently ignore fetch errors (server restarting, etc.)
    }
  }

  async function togglePause() {
    try {
      const data = await $fetch<{ status: string; paused: boolean }>('/api/indexer/pause', {
        method: 'POST',
        body: { paused: !paused.value },
      })
      paused.value = data.paused
      status.value = data.status
    } catch {
      await refresh()
    }
  }

  onMounted(() => {
    refresh()
    timer = setInterval(refresh, pollIntervalMs)
  })

  onUnmounted(() => {
    clearInterval(timer)
  })

  return { status, paused, isRunning, isFinished, filesIndexed, filesTotal, error, togglePause, refresh }
}

export default defineEventHandler(() => {
  return {
    status: indexerState.status,
    paused: indexerState.paused,
    filesIndexed: indexerState.filesIndexed,
    filesTotal: indexerState.filesTotal,
    currentFile: indexerState.currentFile,
    error: indexerState.error,
    lastRun: indexerState.lastRun?.toISOString() ?? null,
  }
})

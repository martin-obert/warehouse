let _resumeGate: (() => void) | null = null

export const indexerState = {
  paused: false,
  gate: Promise.resolve(),
  status: 'idle' as 'idle' | 'running' | 'paused' | 'finished' | 'error',
  phase: null as 'shallow' | 'deep' | null,
  filesIndexed: 0,
  filesTotal: 0,
  currentFile: null as string | null,
  error: null as string | null,
  lastRun: null as Date | null,
}

export function setPaused(paused: boolean) {
  if (paused === indexerState.paused) return

  indexerState.paused = paused

  if (paused) {
    indexerState.gate = new Promise<void>((resolve) => {
      _resumeGate = resolve
    })
    indexerState.status = 'paused'
  } else {
    if (_resumeGate) {
      _resumeGate()
      _resumeGate = null
    }
    indexerState.gate = Promise.resolve()
    indexerState.status = 'running'
  }
}

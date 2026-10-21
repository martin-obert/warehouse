export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const paused = body?.paused

  if (typeof paused !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'body.paused must be a boolean' })
  }

  setPaused(paused)

  return {
    status: indexerState.status,
    paused: indexerState.paused,
  }
})

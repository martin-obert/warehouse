import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import type { FileTarget } from './types'

export class PathAccessError extends Error {
  override name = 'PathAccessError'
  constructor(
    message: string,
    readonly reason: 'invalid' | 'outside-root' | 'not-found',
  ) {
    super(message)
  }
}

const realRoots = new Map<string, Promise<string>>()

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const toPosix = (p: string) => p.split(sep).join('/')

/**
 * Resolve a client-supplied path so it can never escape `root`, neither lexically
 * ("../../etc/passwd") nor through symlinks pointing outside the root.
 *
 * Prefer addressing files by ID (DB row → path) in public APIs; if you must accept
 * paths, this is the check. Symlink races remain possible if untrusted users can
 * write into `root` — don't let them.
 */
export async function resolveInsideRoot(root: string, userPath: string): Promise<Required<FileTarget>> {
  if (typeof userPath !== 'string' || userPath.trim() === '') throw new PathAccessError('A file path is required', 'invalid')
  if (userPath.length > 4096 || userPath.includes('\0')) throw new PathAccessError('Invalid file path', 'invalid')

  // Paths are always relative to the root: "/photos/a.jpg" means "<root>/photos/a.jpg".
  const relativeInput = userPath.replace(/^[/\\]+/, '')
  if (win32.isAbsolute(relativeInput) || /^[a-z]:/i.test(relativeInput)) {
    throw new PathAccessError('Absolute paths are not allowed', 'invalid')
  }

  let realRoot = realRoots.get(root)
  if (!realRoot) {
    realRoot = realpath(root)
    realRoots.set(root, realRoot)
    realRoot.catch(() => realRoots.delete(root))
  }
  const rootPath = await realRoot

  const requestedPath = resolve(rootPath, relativeInput)
  if (!isInside(rootPath, requestedPath)) throw new PathAccessError('Path escapes the storage root', 'outside-root')

  let absolutePath: string
  try {
    absolutePath = await realpath(requestedPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') throw new PathAccessError('File not found', 'not-found')
    throw error
  }
  if (!isInside(rootPath, absolutePath)) throw new PathAccessError('Path resolves outside the storage root', 'outside-root')

  return {
    absolutePath,
    requestedPath,
    displayPath: toPosix(relative(rootPath, requestedPath)),
    resolvedDisplayPath: toPosix(relative(rootPath, absolutePath)),
  }
}

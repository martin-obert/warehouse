import { constants, type BigIntStats } from 'node:fs'
import { access, lstat, stat } from 'node:fs/promises'
import type { FileTarget, FilesystemInfo, Timestamp } from '../types'
import { humanBytes } from '../util'

const PERMISSION_BITS: [number, string][] = [
  [0o400, 'r'], [0o200, 'w'], [0o100, 'x'],
  [0o040, 'r'], [0o020, 'w'], [0o010, 'x'],
  [0o004, 'r'], [0o002, 'w'], [0o001, 'x'],
]

function fileType(st: BigIntStats): FilesystemInfo['type'] {
  if (st.isFile()) return 'file'
  if (st.isDirectory()) return 'directory'
  if (st.isFIFO()) return 'fifo'
  if (st.isSocket()) return 'socket'
  if (st.isBlockDevice()) return 'block-device'
  if (st.isCharacterDevice()) return 'character-device'
  return 'unknown'
}

/** "-rw-r--r--" like `ls -l`, including setuid/setgid/sticky. */
function symbolicMode(mode: number, type: FilesystemInfo['type']): string {
  const chars = PERMISSION_BITS.map(([bit, char]) => (mode & bit ? char : '-'))
  if (mode & 0o4000) chars[2] = chars[2] === 'x' ? 's' : 'S'
  if (mode & 0o2000) chars[5] = chars[5] === 'x' ? 's' : 'S'
  if (mode & 0o1000) chars[8] = chars[8] === 'x' ? 't' : 'T'
  const typeChar = { file: '-', directory: 'd', fifo: 'p', socket: 's', 'block-device': 'b', 'character-device': 'c', unknown: '?' }[type]
  return typeChar + chars.join('')
}

// BigInt() instead of `1_000_000n` literals: Nitro's esbuild target (es2019) warns on BigInt literals.
const NS_PER_MS = BigInt(1_000_000)
const ZERO = BigInt(0)

const timestamp = (ns: bigint): Timestamp => ({ iso: new Date(Number(ns / NS_PER_MS)).toISOString(), epochNs: ns.toString() })

const can = (path: string, mode: number) =>
  access(path, mode).then(
    () => true,
    () => false,
  )

export async function extractFilesystem(target: FileTarget): Promise<FilesystemInfo> {
  const path = target.absolutePath
  // bigint: true → nanosecond timestamps and 64-bit inode/device numbers without precision loss.
  const [st, link, readable, writable, executable] = await Promise.all([
    stat(path, { bigint: true }),
    lstat(target.requestedPath ?? path, { bigint: true }),
    can(path, constants.R_OK),
    can(path, constants.W_OK),
    can(path, constants.X_OK),
  ])

  const type = fileType(st)
  const mode = Number(st.mode)
  const size = Number(st.size)
  // Windows reports no blocks; POSIX st_blocks is always in 512-byte units.
  const hasBlocks = process.platform !== 'win32'
  const allocatedBytes = hasBlocks ? Number(st.blocks) * 512 : null
  const blockSize = hasBlocks ? Number(st.blksize) : null

  return {
    type,
    size,
    sizeHuman: humanBytes(size),
    allocatedBytes,
    sparse: allocatedBytes === null || blockSize === null ? null : type === 'file' && allocatedBytes + blockSize < size,
    blockSize,
    permissions: {
      octal: (mode & 0o7777).toString(8).padStart(4, '0'),
      symbolic: symbolicMode(mode, type),
      setuid: Boolean(mode & 0o4000),
      setgid: Boolean(mode & 0o2000),
      sticky: Boolean(mode & 0o1000),
    },
    owner: { uid: Number(st.uid), gid: Number(st.gid) },
    inode: st.ino.toString(),
    device: st.dev.toString(),
    hardLinks: Number(st.nlink),
    times: {
      modified: timestamp(st.mtimeNs),
      accessed: timestamp(st.atimeNs),
      changed: timestamp(st.ctimeNs), // inode change: content OR metadata (chmod, rename, link count)
      born: st.birthtimeNs > ZERO ? timestamp(st.birthtimeNs) : null, // 0 = filesystem/kernel can't tell
    },
    symlink: link.isSymbolicLink() ? { target: target.resolvedDisplayPath ?? '' } : null,
    access: { readable, writable, executable },
  }
}

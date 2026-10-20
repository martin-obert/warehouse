import type { JsonObject, JsonValue } from './types'

/** Thrown by an extractor to report "skipped" (expected, not an error) instead of "failed". */
export class SkipExtractor extends Error {
  override name = 'SkipExtractor'
}

const MAX_DEPTH = 24
const MAX_ARRAY_ITEMS = 5_000
const MAX_STRING_CHARS = 64 * 1024

/**
 * Convert arbitrary library output into plain JSON: no Buffers, BigInts, Maps, Dates,
 * class instances or cycles. JSON.stringify() would throw on BigInt and silently
 * dump Buffers as giant number arrays, so every section passes through this.
 */
export function toJson(value: unknown, depth = 0, ancestors = new WeakSet<object>()): JsonValue | undefined {
  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}… [${value.length} chars]` : value
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'boolean':
      return value
    case 'bigint':
      return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }
  if (value === null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return { binaryBytes: value.byteLength }
  if (depth >= MAX_DEPTH) return '[max depth]'

  const object = value as object
  if (ancestors.has(object)) return '[circular]'
  ancestors.add(object)
  try {
    if (Array.isArray(object) || object instanceof Set) {
      const items = [...object]
      const out = items.slice(0, MAX_ARRAY_ITEMS).map((item) => toJson(item, depth + 1, ancestors) ?? null)
      if (items.length > MAX_ARRAY_ITEMS) out.push(`… ${items.length - MAX_ARRAY_ITEMS} more`)
      return out
    }
    if (!(object instanceof Map) && typeof (object as { toJSON?: unknown }).toJSON === 'function') {
      return toJson((object as { toJSON(): unknown }).toJSON(), depth + 1, ancestors)
    }
    const entries: Iterable<[unknown, unknown]> = object instanceof Map ? object.entries() : Object.entries(object)
    const out: JsonObject = {}
    for (const [key, item] of entries) {
      const converted = toJson(item, depth + 1, ancestors)
      if (converted !== undefined) out[String(key)] = converted
    }
    return out
  } finally {
    ancestors.delete(object)
  }
}

/** Like toJson() but always returns an object (for sections that must be objects). */
export function toJsonObject(value: unknown): JsonObject {
  const json = toJson(value)
  return json !== null && typeof json === 'object' && !Array.isArray(json) ? json : {}
}

/** Recursively drop null/undefined values and objects that end up empty. */
export function pruneEmpty<T extends JsonValue>(value: T): T | undefined {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) return value.map((item) => pruneEmpty(item) ?? null) as T
  if (typeof value === 'object') {
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      const pruned = pruneEmpty(item)
      if (pruned !== undefined) out[key] = pruned
    }
    return (Object.keys(out).length > 0 ? out : undefined) as T | undefined
  }
  return value
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']

export function humanBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(value < 10 ? 2 : 1)} ${UNITS[unit]}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

/** Parse "30000/1001" style rationals; returns undefined for "0/0" and garbage. */
export function parseRational(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const [num, den] = value.split('/').map(Number)
  if (num === undefined || den === undefined || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined
  return Math.round((num / den) * 1000) / 1000
}

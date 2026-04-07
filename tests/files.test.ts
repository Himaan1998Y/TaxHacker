process.env.BASE_URL = 'http://localhost:7331'

import path from 'path'
import { beforeAll, describe, it, expect } from 'vitest'

let safePathJoin: (basePath: string, ...paths: string[]) => string
let detectMimeType: (firstBytes: Buffer) => string | null
let validateUploadedFile: (file: File, firstBytes: Buffer, options?: { rejectMimeMismatch?: boolean }) => string | null
let extensionFromDetectedMime: (mime: string) => string

beforeAll(async () => {
  const module = await import('@/lib/files')
  safePathJoin = module.safePathJoin
  detectMimeType = module.detectMimeType
  validateUploadedFile = module.validateUploadedFile
  extensionFromDetectedMime = module.extensionFromDetectedMime
})

describe('safePathJoin', () => {
  const basePath = path.resolve('tmp-upload-base')

  it('joins safe paths without traversal', () => {
    const fullPath = safePathJoin(basePath, 'user@example.com', 'receipt.pdf')
    expect(fullPath).toBe(path.resolve(basePath, 'user@example.com', 'receipt.pdf'))
  })

  it('throws when path contains parent directory traversal', () => {
    expect(() => safePathJoin(basePath, '..', 'secret.txt')).toThrow('Path traversal detected')
  })

  it('throws when deep traversal appears in nested segments', () => {
    expect(() => safePathJoin(basePath, 'user', '..', '..', 'secret.txt')).toThrow('Path traversal detected')
  })

  it('throws when path contains URL-encoded traversal sequences', () => {
    expect(() => safePathJoin(basePath, '%2e%2e%2fsecret.txt')).toThrow('Path traversal detected')
  })

  it('throws when path contains a null byte', () => {
    expect(() => safePathJoin(basePath, 'invoice\0.pdf')).toThrow('Path contains null byte')
  })

  it('throws when absolute paths are supplied', () => {
    expect(() => safePathJoin(basePath, '/etc/passwd')).toThrow('Path traversal detected')
  })

  it('throws when traversing with double-encoded separators', () => {
    expect(() => safePathJoin(basePath, '%252e%252e%252fsecret.txt')).toThrow('Path traversal detected')
  })

  it('returns a resolved path inside the base for safe input', () => {
    const result = safePathJoin(basePath, 'user', 'docs', 'invoice.pdf')
    expect(result).toBe(path.resolve(basePath, 'user', 'docs', 'invoice.pdf'))
  })
})

describe('upload MIME validation', () => {
  it('detects PNG from magic bytes', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00])
    expect(detectMimeType(bytes)).toBe('image/png')
  })

  it('rejects RIFF payloads that are not WEBP', () => {
    const bytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x2a, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45,
    ])
    expect(detectMimeType(bytes)).toBeNull()
  })

  it('rejects MIME spoofing when strict mismatch checks are enabled', () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
    ])
    const spoofedFile = new File([pngBytes], 'invoice.pdf', { type: 'application/pdf' })
    const error = validateUploadedFile(spoofedFile, pngBytes, { rejectMimeMismatch: true })
    expect(error).toContain('MIME type does not match file contents')
  })

  it('maps detected MIME to canonical file extension', () => {
    expect(extensionFromDetectedMime('image/png')).toBe('.png')
    expect(extensionFromDetectedMime('application/pdf')).toBe('.pdf')
  })
})

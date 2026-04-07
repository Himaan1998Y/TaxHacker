import { File, Transaction, User } from "@/prisma/client"
import { access, constants, readdir, stat } from "fs/promises"
import path from "path"
import config from "./config"

export const FILE_UPLOAD_PATH = path.resolve(process.env.UPLOAD_PATH || "./uploads")
export const FILE_UNSORTED_DIRECTORY_NAME = "unsorted"
export const FILE_PREVIEWS_DIRECTORY_NAME = "previews"
export const FILE_STATIC_DIRECTORY_NAME = "static"
export const FILE_IMPORT_CSV_DIRECTORY_NAME = "csv"

export function getUserUploadsDirectory(user: User) {
  return safePathJoin(FILE_UPLOAD_PATH, user.email)
}

export function getStaticDirectory(user: User) {
  return safePathJoin(getUserUploadsDirectory(user), FILE_STATIC_DIRECTORY_NAME)
}

export function getUserPreviewsDirectory(user: User) {
  return safePathJoin(getUserUploadsDirectory(user), FILE_PREVIEWS_DIRECTORY_NAME)
}

export function unsortedFilePath(fileUuid: string, filename: string) {
  const fileExtension = path.extname(filename)
  return path.posix.join(FILE_UNSORTED_DIRECTORY_NAME, `${fileUuid}${fileExtension}`)
}

export function previewFilePath(fileUuid: string, page: number) {
  return path.posix.join(FILE_PREVIEWS_DIRECTORY_NAME, `${fileUuid}.${page}.webp`)
}

export function getTransactionFileUploadPath(fileUuid: string, filename: string, transaction: Transaction) {
  const fileExtension = path.extname(filename)
  const storedFileName = `${fileUuid}${fileExtension}`
  return formatFilePath(storedFileName, transaction.issuedAt || new Date())
}

export function fullPathForFile(user: User, file: File) {
  const userUploadsDirectory = getUserUploadsDirectory(user)
  return safePathJoin(userUploadsDirectory, file.path)
}

function formatFilePath(filename: string, date: Date, format = "{YYYY}/{MM}/{name}{ext}") {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const ext = path.extname(filename)
  const name = path.basename(filename, ext)

  return format.replace("{YYYY}", String(year)).replace("{MM}", month).replace("{name}", name).replace("{ext}", ext)
}

function decodePathSegment(segment: string): string {
  let decoded = segment
  for (let i = 0; i < 5; i += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  if (decoded.includes('\0')) {
    throw new Error('Path contains null byte')
  }
  return decoded
}

export function safePathJoin(basePath: string, ...paths: string[]) {
  const sanitizedSegments = paths.map((segment) => {
    if (typeof segment !== 'string') {
      throw new Error('Invalid path segment')
    }
    return decodePathSegment(segment)
  })

  const normalizedBase = path.resolve(basePath)
  const joinedPath = path.resolve(normalizedBase, ...sanitizedSegments)
  const relative = path.relative(normalizedBase, joinedPath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected')
  }

  return joinedPath
}

export async function fileExists(filePath: string) {
  try {
    await access(path.normalize(filePath), constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function getDirectorySize(directoryPath: string) {
  let totalSize = 0
  async function calculateSize(dir: string) {
    const files = await readdir(dir, { withFileTypes: true })
    for (const file of files) {
      const fullPath = path.join(dir, file.name)
      if (file.isDirectory()) {
        await calculateSize(fullPath)
      } else if (file.isFile()) {
        const stats = await stat(fullPath)
        totalSize += stats.size
      }
    }
  }
  await calculateSize(directoryPath)
  return totalSize
}

// ── File upload validation ──────────────────────────────────────────────────

export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB per file

/** Magic bytes for allowed file types */
const MAGIC_SIGNATURES: { bytes: number[]; mime: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" }, // %PDF
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },            // JPEG
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },       // PNG
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },       // GIF8
  { bytes: [0x42, 0x4d], mime: "image/bmp" },                   // BM (BMP)
]

const WEBP_RIFF_PREFIX = [0x52, 0x49, 0x46, 0x46] // RIFF
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] // WEBP
const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
}

function bytesMatch(source: Buffer, expected: number[], offset = 0) {
  return expected.every((byte, index) => source[offset + index] === byte)
}

export function detectMimeType(firstBytes: Buffer): string | null {
  if (firstBytes.length < 4) {
    return null
  }

  for (const signature of MAGIC_SIGNATURES) {
    if (bytesMatch(firstBytes, signature.bytes)) {
      return signature.mime
    }
  }

  // WebP requires both RIFF at offset 0 and WEBP at offset 8.
  if (firstBytes.length >= 12 && bytesMatch(firstBytes, WEBP_RIFF_PREFIX, 0) && bytesMatch(firstBytes, WEBP_TAG, 8)) {
    return "image/webp"
  }

  return null
}

export function extensionFromDetectedMime(mime: string): string {
  return MIME_TO_EXTENSION[mime] || ""
}

export type UploadValidationOptions = {
  rejectMimeMismatch?: boolean
}

/**
 * Validate an uploaded file's size and magic bytes.
 * Returns an error string if invalid, null if valid.
 * Uses globalThis.File to avoid collision with the Prisma File model.
 */
export function validateUploadedFile(
  file: globalThis.File,
  firstBytes: Buffer,
  options: UploadValidationOptions = {}
): string | null {
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File '${file.name}' exceeds the 50 MB size limit.`
  }
  if (file.size === 0) {
    return `File '${file.name}' is empty.`
  }

  const detectedMime = detectMimeType(firstBytes)
  if (!detectedMime) {
    return `File '${file.name}' has an unsupported format. Only PDF and images are allowed.`
  }

  if (options.rejectMimeMismatch) {
    const clientMime = (file.type || "").trim().toLowerCase()
    if (clientMime && clientMime !== "application/octet-stream" && clientMime !== detectedMime) {
      return `File '${file.name}' MIME type does not match file contents.`
    }
  }

  return null
}

export function isEnoughStorageToUploadFile(user: User, fileSize: number) {
  if (config.selfHosted.isEnabled || user.storageLimit < 0) {
    return true
  }
  return Number(user.storageUsed) + fileSize <= Number(user.storageLimit)
}

import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { createFile } from "@/models/files"
import {
  MAX_UPLOAD_SIZE_BYTES,
  detectMimeType,
  extensionFromDetectedMime,
  getUserUploadsDirectory,
  isEnoughStorageToUploadFile,
  safePathJoin,
  unsortedFilePath,
  validateUploadedFile,
} from "@/lib/files"
import { randomUUID } from "crypto"
import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"

const MAX_MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_UPLOAD_SIZE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES

/**
 * POST /api/agent/files — Upload a file (invoice, receipt, etc.)
 *
 * Content-Type: multipart/form-data
 * Body: file (binary)
 *
 * Returns: { fileId, filename }
 * Use the fileId with POST /api/agent/analyze to trigger AI extraction.
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const contentLength = Number(req.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Request payload exceeds limit." }, { status: 413 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field" },
      { status: 400 }
    )
  }

  const file = formData.get("file")
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file provided. Send a 'file' field in multipart form data." },
      { status: 400 }
    )
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 })
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return NextResponse.json({ error: "File exceeds 50MB limit." }, { status: 413 })
  }

  if (!isEnoughStorageToUploadFile(user, file.size)) {
    return NextResponse.json({ error: "Storage quota exceeded." }, { status: 400 })
  }

  try {
    const userUploadsDirectory = getUserUploadsDirectory(user)
    const fileUuid = randomUUID()

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const sniffBytes = buffer.subarray(0, 16)

    const validationError = validateUploadedFile(file, sniffBytes, { rejectMimeMismatch: true })
    if (validationError) {
      const isMimeError = validationError.includes("unsupported format") || validationError.includes("MIME type")
      return NextResponse.json({ error: validationError }, { status: isMimeError ? 415 : 400 })
    }

    const detectedMime = detectMimeType(sniffBytes)
    if (!detectedMime) {
      return NextResponse.json({ error: "Unsupported file format." }, { status: 415 })
    }

    const extension = extensionFromDetectedMime(detectedMime)
    const storageFilename = `upload${extension}`
    const relativeFilePath = unsortedFilePath(fileUuid, storageFilename)
    const fullFilePath = safePathJoin(userUploadsDirectory, relativeFilePath)

    await mkdir(path.dirname(fullFilePath), { recursive: true })
    await writeFile(fullFilePath, buffer)

    try {
      const fileRecord = await createFile(user.id, {
        id: fileUuid,
        filename: file.name,
        path: relativeFilePath,
        mimetype: detectedMime,
        clientMimetype: file.type || null,
        detectedMimetype: detectedMime,
        metadata: {
          size: file.size,
          uploadedVia: "agent-api",
          clientMime: file.type || null,
          detectedMime,
          mimeMismatch: Boolean(file.type && file.type !== detectedMime),
        },
      })

      return NextResponse.json(
        { fileId: fileRecord.id, filename: fileRecord.filename },
        { status: 201 }
      )
    } catch (dbError) {
      await unlink(fullFilePath).catch(() => undefined)
      throw dbError
    }
  } catch (error) {
    console.error("Agent API: file upload error:", error)
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    )
  }
}

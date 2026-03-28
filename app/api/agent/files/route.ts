import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { createFile } from "@/models/files"
import {
  getUserUploadsDirectory,
  unsortedFilePath,
  safePathJoin,
} from "@/lib/files"
import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"

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

  // Validate file type
  const allowedPrefixes = ["image/", "application/pdf"]
  const isAllowed = allowedPrefixes.some((prefix) => file.type.startsWith(prefix))
  if (!isAllowed) {
    return NextResponse.json(
      { error: `File type '${file.type}' not supported. Send images or PDFs.` },
      { status: 400 }
    )
  }

  try {
    const userUploadsDirectory = getUserUploadsDirectory(user)
    const fileUuid = randomUUID()
    const relativeFilePath = unsortedFilePath(fileUuid, file.name)
    const fullFilePath = safePathJoin(userUploadsDirectory, relativeFilePath)

    await mkdir(path.dirname(fullFilePath), { recursive: true })

    const arrayBuffer = await file.arrayBuffer()
    await writeFile(fullFilePath, Buffer.from(arrayBuffer))

    const fileRecord = await createFile(user.id, {
      id: fileUuid,
      filename: file.name,
      path: relativeFilePath,
      mimetype: file.type,
      metadata: {
        size: file.size,
        uploadedVia: "agent-api",
      },
    })

    return NextResponse.json(
      { fileId: fileRecord.id, filename: fileRecord.filename },
      { status: 201 }
    )
  } catch (error) {
    console.error("Agent API: file upload error:", error)
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    )
  }
}

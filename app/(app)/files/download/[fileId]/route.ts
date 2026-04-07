import { getCurrentUser } from "@/lib/auth"
import { fileExists, fullPathForFile } from "@/lib/files"
import { encodeFilename } from "@/lib/utils"
import { getFileById } from "@/models/files"
import fs from "fs/promises"
import { NextResponse } from "next/server"

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const user = await getCurrentUser()

  if (!fileId) {
    return new NextResponse("No fileId provided", { status: 400 })
  }

  try {
    // Find file in database
    const file = await getFileById(fileId, user.id)

    if (!file || file.userId !== user.id) {
      return new NextResponse("File not found or does not belong to the user", { status: 404 })
    }

    // Check if file exists
    const fullFilePath = fullPathForFile(user, file)
    const isFileExists = await fileExists(fullFilePath)
    if (!isFileExists) {
      return new NextResponse("File not found on disk", { status: 404 })
    }

    // Read file
    const fileBuffer = await fs.readFile(fullFilePath)

    // Validate MIME type — force safe content type for downloads
    const safeMimeType = file.mimetype.startsWith("image/") || file.mimetype === "application/pdf"
      ? file.mimetype
      : "application/octet-stream"

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": safeMimeType,
        "Content-Disposition": `attachment; filename*=${encodeFilename(file.filename)}`,
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Error serving file:", error)
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}

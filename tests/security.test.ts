import path from "path"
import { describe, expect, it } from "vitest"
import { MAX_UPLOAD_SIZE_BYTES, detectMimeType, safePathJoin, validateUploadedFile } from "@/lib/files"

describe("upload security guards", () => {
  it("rejects MIME spoofing (PDF claim with PNG bytes)", () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const spoofed = new File([pngBytes], "invoice.pdf", { type: "application/pdf" })
    const error = validateUploadedFile(spoofed, pngBytes, { rejectMimeMismatch: true })
    expect(error).toContain("MIME type does not match")
  })

  it("rejects oversize uploads", () => {
    const tooLarge = new File([Buffer.alloc(0)], "big.pdf", { type: "application/pdf" })
    Object.defineProperty(tooLarge, "size", { value: MAX_UPLOAD_SIZE_BYTES + 1 })
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46])
    const error = validateUploadedFile(tooLarge, bytes)
    expect(error).toContain("exceeds the 50 MB size limit")
  })

  it("detects true WebP signature only when WEBP tag exists", () => {
    const validWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x2a, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ])
    const fakeRiff = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x2a, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45,
    ])

    expect(detectMimeType(validWebp)).toBe("image/webp")
    expect(detectMimeType(fakeRiff)).toBeNull()
  })
})

describe("path traversal protection", () => {
  it("blocks traversal attempts in file paths", () => {
    const basePath = path.resolve("tmp-upload-base")
    expect(() => safePathJoin(basePath, "..", "..", "etc", "passwd")).toThrow("Path traversal detected")
  })

  it("blocks null-byte path payloads", () => {
    const basePath = path.resolve("tmp-upload-base")
    expect(() => safePathJoin(basePath, "evil\0.png")).toThrow("Path contains null byte")
  })
})

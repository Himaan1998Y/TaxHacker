import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { getFileById } from "@/models/files"
import { getSettings, getLLMSettings } from "@/models/settings"
import { getFields } from "@/models/fields"
import { getCategories } from "@/models/categories"
import { getProjects } from "@/models/projects"
import { loadAttachmentsForAI } from "@/ai/attachments"
import { buildLLMPrompt } from "@/ai/prompt"
import { DEFAULT_PROMPT_ANALYSE_NEW_FILE } from "@/models/defaults"
import { fieldsToJsonSchema } from "@/ai/schema"
import { analyzeTransaction } from "@/ai/analyze"

/**
 * POST /api/agent/analyze — Trigger AI analysis on an uploaded file
 *
 * Body: { fileId: string }
 *
 * Returns the LLM-extracted structured data (merchant, total, GST, etc.)
 * The result is also cached on the File record for later use.
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  let body: { fileId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.fileId) {
    return NextResponse.json(
      { error: "fileId is required" },
      { status: 400 }
    )
  }

  // Get the file record
  const file = await getFileById(body.fileId, user.id)
  if (!file) {
    return NextResponse.json(
      { error: "File not found" },
      { status: 404 }
    )
  }

  // If already analyzed, return cached result
  if (file.cachedParseResult && Object.keys(file.cachedParseResult as object).length > 0) {
    return NextResponse.json({
      output: file.cachedParseResult,
      cached: true,
    })
  }

  try {
    // Load file attachments (converts to base64 images for LLM)
    const attachments = await loadAttachmentsForAI(user, file)

    // Build prompt with current fields, categories, projects
    const [settings, fields, categories, projects] = await Promise.all([
      getSettings(user.id),
      getFields(user.id),
      getCategories(user.id),
      getProjects(user.id),
    ])

    const prompt = buildLLMPrompt(
      settings.prompt_analyse_new_file || DEFAULT_PROMPT_ANALYSE_NEW_FILE,
      fields,
      categories,
      projects
    )
    const schema = fieldsToJsonSchema(fields)

    // Run AI analysis
    const result = await analyzeTransaction(prompt, schema, attachments, file.id, user.id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "AI analysis failed" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      output: result.data?.output,
      tokensUsed: result.data?.tokensUsed,
      cached: false,
    })
  } catch (error) {
    console.error("Agent API: analyze error:", error)
    return NextResponse.json(
      { error: "Failed to analyze file" },
      { status: 500 }
    )
  }
}

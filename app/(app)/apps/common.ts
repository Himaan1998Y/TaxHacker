import { manifest as invoicesManifest } from "./invoices/manifest"
import { manifest as gstr1Manifest } from "./gstr1/manifest"
import { manifest as gstr3bManifest } from "./gstr3b/manifest"

export type AppManifest = {
  name: string
  description: string
  icon: string
}

// Static registry — dynamic fs.readdir breaks in Next.js standalone builds
const APP_REGISTRY: { id: string; manifest: AppManifest }[] = [
  { id: "invoices", manifest: invoicesManifest },
  { id: "gstr1", manifest: gstr1Manifest },
  { id: "gstr3b", manifest: gstr3bManifest },
]

export async function getApps(): Promise<{ id: string; manifest: AppManifest }[]> {
  return APP_REGISTRY
}

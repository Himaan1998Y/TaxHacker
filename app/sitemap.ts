import config from "@/lib/config"
import { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const baseURL = config.app.baseURL

  return [
    {
      url: baseURL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseURL}/docs/privacy_policy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseURL}/docs/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]
}

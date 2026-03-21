import config from "@/lib/config"
import { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/settings/", "/transactions/", "/export/", "/unsorted/", "/files/", "/import/"],
    },
    sitemap: `${config.app.baseURL}/sitemap.xml`,
  }
}

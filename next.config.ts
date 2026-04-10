import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true, // TODO: make me linting again
  },
  images: {
    unoptimized: true, // FIXME: bug on prod, images always empty, investigate later
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "55mb",  // 50MB file + overhead for multipart encoding
    },
  },
  headers: async () => {
    // NOTE: Content-Security-Policy is set per-request in middleware.ts with a
    // cryptographic nonce, which replaces 'unsafe-inline'. Static headers here
    // cannot carry a nonce (they are fixed at build time), so CSP lives only in
    // middleware. All other security headers that don't need per-request values
    // remain here.
    return [
      {
        source: "/(.*)",
        headers: [
          // H-7: HSTS with includeSubDomains + preload (submit domain to
          // https://hstspreload.org/ after first production deploy).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ]
  },
}

const isSentryEnabled = process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT

export default isSentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: !process.env.CI,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      disableLogger: true,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
    })
  : nextConfig

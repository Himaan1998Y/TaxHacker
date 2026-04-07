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
    // CSP: in dev Next.js turbopack requires unsafe-eval for HMR, but in
    // production we drop it. unsafe-inline remains for inline styles the
    // Next.js runtime still emits; moving to a nonce-based policy is a
    // larger refactor tracked separately.
    const isDev = process.env.NODE_ENV !== "production"
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'"

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
          {
            // H-5: unsafe-eval removed in production.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",     // Tailwind / Next.js inline styles
              "img-src 'self' data: blob:",           // data: for base64, blob: for previews
              "font-src 'self' data:",
              "connect-src 'self' https://*.sentry.io",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
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

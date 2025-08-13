// next.config.mjs
import bundleAnalyzer from "@next/bundle-analyzer"

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  /**
   * Global security headers.
   * @returns {Promise<import('next').Headers>} Header rules.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" }
        ]
      }
    ]
  },

  experimental: {
    optimizePackageImports: ["react-icons"]
  },

  // keep these external at runtime when using standalone output
  serverExternalPackages: ["nodemailer", "tailwind-merge"]
}

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true"
})

export default withBundleAnalyzer(nextConfig)

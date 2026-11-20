import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ["react-leaflet", "leaflet"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/py/:path*",
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

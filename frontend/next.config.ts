import type { NextConfig } from "next";

const defaultBackendUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.BACKEND_API_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://jaldurbin.onrender.com"
    : "http://localhost:8000");

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ["react-leaflet", "leaflet"],
  env: {
    NEXT_PUBLIC_API_URL: defaultBackendUrl,
  },
  async rewrites() {
    return [
      {
        source: "/api/py/:path*",
        destination: `${defaultBackendUrl}/api/v1/:path*`,
      },
      {
        source: "/api/backend/:path*",
        destination: `${defaultBackendUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

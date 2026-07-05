import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB. Images are downscaled client-side to a ~4MB cap
      // before upload (see MAX_UPLOAD_BYTES in dashboard.tsx), so this just
      // needs headroom over that plus multipart overhead — kept modest since
      // hosting platforms typically also enforce their own payload ceiling
      // independent of this setting.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // Development only. The browser talks to Next, Next talks to Django, so the
  // session cookie is first-party and no CORS is involved. In production nginx
  // does exactly this, which is why the app needs no corsheaders anywhere.
  async rewrites() {
    const backend = process.env.MAIL_BACKEND_URL ?? "http://127.0.0.1:8001";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/auth/handoff", destination: `${backend}/auth/handoff` },
    ];
  },

  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // The app shell must never be framed, and must never leak a URL to a
        // sender. Message HTML renders in its own sandboxed origin, not here.
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};
module.exports = nextConfig;

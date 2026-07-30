/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained build (.next/standalone) for a small Docker image.
  output: "standalone",
  // three.js / React Three Fiber ship untranspiled ESM — let Next compile them.
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],

  /**
   * Old Software & Subscriptions URLs.
   *
   * The Digital Estate replaces both modules, and people have these paths
   * bookmarked, pasted into tickets and linked from old emails. A 404 would
   * read as "the feature is gone" rather than "it moved".
   *
   * Permanent (308) as of Phase 5: the old routes and their API are gone, so
   * there is nothing left to take back. Until then these were 307, because a
   * permanent redirect would have been cached past the point of recall.
   */
  async redirects() {
    return [
      { source: "/licenses/estate", destination: "/estate/dashboard", permanent: true },
      {
        source: "/licenses/estate/:id",
        destination: "/estate/properties/:id",
        permanent: true,
      },
      { source: "/licenses", destination: "/estate/dashboard", permanent: true },
      { source: "/licenses/list", destination: "/estate/services", permanent: true },
      { source: "/licenses/my", destination: "/estate/services", permanent: true },
      { source: "/licenses/:id", destination: "/estate/services", permanent: true },
      { source: "/subscriptions", destination: "/estate/services", permanent: true },
      { source: "/subscriptions/:id", destination: "/estate/services", permanent: true },
      { source: "/reports/licenses", destination: "/estate/dashboard", permanent: true },
    ];
  },
};

export default nextConfig;

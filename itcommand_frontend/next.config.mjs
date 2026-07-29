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
   * Deliberately temporary (307, the default): the old routes are still
   * present until Phase 5 deletes them, and a permanent redirect would be
   * cached by browsers past the point where we could take it back.
   */
  async redirects() {
    return [
      { source: "/licenses/estate", destination: "/estate/dashboard", permanent: false },
      {
        source: "/licenses/estate/:id",
        destination: "/estate/properties/:id",
        permanent: false,
      },
      { source: "/licenses", destination: "/estate/dashboard", permanent: false },
      { source: "/licenses/list", destination: "/estate/services", permanent: false },
      { source: "/licenses/my", destination: "/estate/services", permanent: false },
      { source: "/licenses/:id", destination: "/estate/services", permanent: false },
      { source: "/subscriptions", destination: "/estate/services", permanent: false },
      { source: "/subscriptions/:id", destination: "/estate/services", permanent: false },
    ];
  },
};

export default nextConfig;

"use client";

/**
 * `/licenses/estate` has no page of its own — the Estate lives as a tab on the
 * Software & Subscriptions hub. This exists so the bare URL, a stale bookmark,
 * or a hand-typed path lands somewhere useful instead of a 404.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EstateIndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/licenses?tab=estate");
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
    </div>
  );
}

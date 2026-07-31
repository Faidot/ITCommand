"use client";

/** `/estate` has no page of its own — the dashboard is the landing screen. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EstateIndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/estate/dashboard");
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

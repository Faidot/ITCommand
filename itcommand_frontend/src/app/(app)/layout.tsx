"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { Loader2 } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { FooterBar } from "@/components/footer-bar";
import { ErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SplitScreenContainer } from "@/components/split-screen-container";
import { BackgroundBlobs } from "@/components/background-blobs";
import { ExtensionInstallPrompt } from "@/components/extension/extension-install-prompt";
import { RouteGuard } from "@/components/route-guard";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading, loadFromStorage } = useAuthStore();
  const loadSettings = useSettingsStore((state) => state.load);
  const [isMounted, setIsMounted] = useState(false);
  const isBare = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("layout") === "bare" : false;

  useEffect(() => {
    setIsMounted(true);
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && isMounted) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router, isMounted]);

  // Company-wide display settings (currency, company name) drive every page.
  useEffect(() => {
    if (isAuthenticated) void loadSettings();
  }, [isAuthenticated, loadSettings]);

  if (isLoading || !isMounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  // Bare layout for iframe split screen
  if (isBare) {
    return (
      <TooltipProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground relative overflow-hidden">
          <BackgroundBlobs />
          <main className="flex-1 overflow-auto p-4 relative z-10">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex flex-col min-h-screen w-full bg-background text-foreground relative overflow-hidden">
          <BackgroundBlobs />
          
          {/* Header Full Width */}
          <TopBar />

          {/* Middle Section: Sidebar + Content Area */}
          <div className="flex flex-1 overflow-hidden relative">
            <AppSidebar />
            <main className="flex-1 overflow-auto bg-transparent flex flex-col p-4 md:p-5 pb-16 md:pb-5">
              <ErrorBoundary>
                <SplitScreenContainer>
                  <RouteGuard>
                    {children}
                  </RouteGuard>
                </SplitScreenContainer>
              </ErrorBoundary>
            </main>
          </div>

          {/* Footer Full Width */}
          <FooterBar />
          <BottomNav />
          <ExtensionInstallPrompt />
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}

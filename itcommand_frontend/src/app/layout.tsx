import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { UiPrefsProvider, UiPrefsScript } from "@/components/ui-prefs-provider";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "IT Command | Complete IT Management Platform",
  description: "Enterprise platform for managing assets, IT budgets, credentials, and departmental configurations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before hydration, so the app never paints at full motion and
            default text size and then jumps once the store loads. */}
        <UiPrefsScript />
      </head>
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "font-sans antialiased bg-background text-foreground"
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
        >
          <UiPrefsProvider />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Terafort Mail",
  description: "Company mail for Terafort",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

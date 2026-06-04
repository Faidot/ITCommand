"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Box, Wallet, Settings } from "lucide-react"

export function BottomNav() {
  const pathname = usePathname()
  
  const navItems = [
    { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    { label: "People", icon: Users, href: "/users" },
    { label: "Assets", icon: Box, href: "/assets" },
    { label: "Finance", icon: Wallet, href: "/finance/budget" },
    { label: "Settings", icon: Settings, href: "/settings" },
  ]

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-background/90 backdrop-blur-xl border-t border-border flex justify-around items-center px-2 z-50 pb-safe">
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href)
        return (
          <Link 
            key={item.label} 
            href={item.href}
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
          >
            <item.icon className={`h-5 w-5 transition-all ${isActive ? "scale-110" : ""}`} />
            <span className={`text-[10px] font-medium ${isActive ? "text-primary" : ""}`}>{item.label}</span>
          </Link>
        )
      })}
    </div>
  )
}

"use client"

import * as React from "react"
import { PlusCircle, LifeBuoy, FileText } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export function FooterBar() {
  return (
    <footer className="hidden md:flex border-t border-border/50 bg-background/60 backdrop-blur-xl px-6 py-2 items-center justify-between text-[10px] uppercase tracking-wider font-medium text-muted-foreground shrink-0 shadow-[0_-1px_3px_rgba(0,0,0,0.02)]">
      <div className="flex items-center gap-6">
        <span className="opacity-70">&copy; {new Date().getFullYear()} IT Command</span>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 normal-case tracking-normal text-xs">
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Systems Operational</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/helpdesk/tickets?new=1">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl transition-all">
            <PlusCircle className="h-4 w-4" />
            New Ticket
          </Button>
        </Link>
        <Link href="/kb/articles/new">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl transition-all">
            <FileText className="h-4 w-4" />
            New Article
          </Button>
        </Link>
        <div className="w-[1px] h-4 bg-border/50 mx-1" />
        <Link href="/helpdesk">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-2 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-xl transition-all">
            <LifeBuoy className="h-4 w-4" />
            Support
          </Button>
        </Link>
      </div>
    </footer>
  )
}

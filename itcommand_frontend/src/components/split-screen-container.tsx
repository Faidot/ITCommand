"use client"

import * as React from "react"
import { useSplitScreenStore } from "@/store/splitScreenStore"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { X, Columns2 } from "lucide-react"
import { useAuthStore } from "@/store/authStore"
import { can, moduleForPath } from "@/lib/permissions"
import { Button } from "./ui/button"

/**
 * Pages offerable in the right-hand pane.
 *
 * The module each belongs to is derived from its URL via `moduleForPath`,
 * rather than tagged here, so this list cannot drift out of step with the
 * route guard: if a page is gated, the same rule gates its split-screen entry.
 */
const SPLIT_PAGES = [
  { label: "Dashboard", url: "/dashboard", group: "Overview" },
  { label: "Users", url: "/users", group: "People" },
  { label: "Departments", url: "/departments", group: "People" },
  { label: "Onboarding", url: "/onboarding", group: "People" },
  { label: "Asset Inventory", url: "/assets", group: "Assets" },
  { label: "Asset Notes", url: "/asset-notes", group: "Assets" },
  // Digital Estate replaced Software Licenses in Phase 5. The old /licenses
  // entry outlived the route it pointed at and offered a guaranteed 404.
  { label: "Digital Estate", url: "/estate/dashboard", group: "Assets" },
  { label: "Estate Services", url: "/estate/services", group: "Assets" },
  { label: "Cards & Charges", url: "/estate/payments", group: "Assets" },
  { label: "Seating Plan", url: "/seating", group: "Assets" },
  { label: "Vendors", url: "/vendors", group: "Procurement" },
  { label: "Purchase Requests", url: "/procurement/requests", group: "Procurement" },
  { label: "Network Overview", url: "/network", group: "Network" },
  { label: "Network Devices", url: "/network/devices", group: "Network" },
  { label: "IP Manager", url: "/network/ip-manager", group: "Network" },
  { label: "Rack View", url: "/network/rack-view", group: "Network" },
  { label: "KB Home", url: "/kb", group: "Knowledge Base" },
  { label: "All Articles", url: "/kb/articles", group: "Knowledge Base" },
  { label: "Password Vault", url: "/vault/passwords", group: "Vault" },
  { label: "Workspaces", url: "/vault/workspaces", group: "Vault" },
  { label: "Budget", url: "/finance/budget", group: "Finance" },
  { label: "Income", url: "/finance/income", group: "Transactions" },
  { label: "Expenses", url: "/finance/expenses", group: "Transactions" },
  { label: "Recurring Bills", url: "/finance/recurring-bills", group: "Transactions" },
  { label: "Cost Overview", url: "/finance/cost-overview", group: "Transactions" },
  { label: "Financial Reports", url: "/reports/financial", group: "Reports" },
  { label: "Asset Reports", url: "/reports/assets", group: "Reports" },
  { label: "Helpdesk Dashboard", url: "/helpdesk", group: "Helpdesk" },
  { label: "All Tickets", url: "/helpdesk/tickets", group: "Helpdesk" },
  { label: "My Tickets", url: "/helpdesk/my-tickets", group: "Helpdesk" },
  { label: "App Settings", url: "/settings", group: "System" },
  { label: "Audit Logs", url: "/settings/audit-log", group: "System" },
]

export function SplitScreenContainer({ children }: { children: React.ReactNode }) {
  const { isSplit, rightPageUrl, setRightPage, toggleSplit } = useSplitScreenStore()
  const { user } = useAuthStore()
  const [isBare, setIsBare] = React.useState(false)
  const [isMobile, setIsMobile] = React.useState(false)

  // Only pages this role can actually open. The list was unfiltered, so a user
  // with one module was offered thirty pages that would all refuse them.
  const pages = React.useMemo(() => {
    return SPLIT_PAGES.filter((page) => {
      const mod = moduleForPath(page.url)
      return !mod || can(user, mod, "view")
    })
  }, [user])

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.get("layout") === "bare") {
        setIsBare(true)
      }
      
      const checkMobile = () => setIsMobile(window.innerWidth < 1024)
      checkMobile()
      window.addEventListener("resize", checkMobile)
      return () => window.removeEventListener("resize", checkMobile)
    }
  }, [])

  if (isBare) {
    return <div className="h-full w-full overflow-auto bg-background p-4">{children}</div>
  }

  // No split on mobile/tablet
  if (!isSplit || isMobile) {
    return <div className="flex-1 w-full h-full overflow-auto">{children}</div>
  }

  // The store defaults the right pane to /dashboard, which this role may not
  // be allowed to open — that would put "Access Denied" inside the pane the
  // moment split screen is switched on. Fall back to the first page they can.
  const activeUrl = pages.some(p => p.url === rightPageUrl)
    ? rightPageUrl
    : pages[0]?.url

  if (!activeUrl) {
    return <div className="flex-1 w-full h-full overflow-auto">{children}</div>
  }

  const selectedPage = pages.find(p => p.url === activeUrl)

  return (
    <div className="flex w-full h-[calc(100vh-8rem)] gap-4 relative animate-in fade-in zoom-in-95 duration-500">
      {/* Left panel: current page */}
      <div className="flex-1 min-w-0 overflow-auto rounded-3xl border border-border/50 bg-card/50 backdrop-blur-xl shadow-2xl shadow-black/5 dark:shadow-white/5 transition-all duration-300">
        {children}
      </div>

      {/* Right panel: selected page via iframe */}
      <div className="flex-1 min-w-0 flex flex-col rounded-3xl border border-border/50 bg-card/50 backdrop-blur-xl shadow-2xl shadow-black/5 dark:shadow-white/5 overflow-hidden transition-all duration-500 hover:shadow-primary/5">
        {/* Header with page selector */}
        <div className="h-12 border-b border-border/50 flex items-center justify-between px-4 bg-muted/20 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-primary/10 text-primary shadow-inner">
              <Columns2 className="h-4 w-4" />
            </div>
            <Select value={activeUrl} onValueChange={setRightPage}>
              <SelectTrigger className="w-[200px] h-8 text-xs bg-background/50 border-border/50 hover:bg-background/80 transition-colors rounded-xl">
                <SelectValue placeholder="Select page..." />
              </SelectTrigger>
              <SelectContent className="max-h-[400px] rounded-2xl border-border/50 backdrop-blur-2xl">
                {pages.map(page => (
                  <SelectItem key={page.url} value={page.url} className="text-xs rounded-lg mx-1 focus:bg-primary/10">
                    <span className="text-muted-foreground mr-1">{page.group} /</span> {page.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={toggleSplit} 
            className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all active:scale-90"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Iframe content */}
        <div className="flex-1 relative bg-transparent overflow-hidden">
          <iframe 
            key={activeUrl}
            src={`${activeUrl}?layout=bare`} 
            className="w-full h-full border-0 animate-in fade-in-0 duration-300"
            title={selectedPage?.label || "Split View"}
          />
        </div>
      </div>
    </div>
  )
}

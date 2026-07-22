"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Users,
  Building,
  Box,
  FileText,
  KeyRound,
  Shield,
  Wallet,
  ReceiptText,
  CreditCard,
  ArrowDownCircle,
  ArrowUpCircle,
  ChartBar,
  LineChart,
  LayoutDashboard,
  Server,
  LogOut,
  User as UserIcon,
  Settings,
  Activity,
  Headset,
  TicketCheck,
  ListTodo,
  Map,
  UserPlus,
  ShoppingCart,
  Network,
  HardDrive,
  Radar,
  Globe,
  BookOpen,
  Share2,
  ClipboardList,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuthStore } from "@/store/authStore"
import { can } from "@/lib/permissions"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { BackgroundBlobs } from "@/components/background-blobs"

export function AppSidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()
  const { toggleSidebar, state } = useSidebar()
  const isCollapsed = state === "collapsed"

  const navGroups = [
    {
      label: "OVERVIEW",
      items: [
        { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, module: "dashboard" },
      ],
    },
    {
      label: "PEOPLE",
      items: [
        { title: "Users", url: "/users", icon: Users, module: "users" },
        { title: "Departments", url: "/departments", icon: Building, module: "departments" },
        { title: "Onboarding", url: "/onboarding", icon: UserPlus, module: "onboarding" },
        { title: "Seating Plan", url: "/seating", icon: Map, module: "seating" },
      ],
    },
    {
      label: "ASSETS",
      items: [
        { title: "Asset Inventory", url: "/assets", icon: Box, module: "assets" },
        { title: "Asset Notes", url: "/asset-notes", icon: FileText, module: "assets" },
        { title: "Software Licenses", url: "/licenses", icon: KeyRound, module: "licenses" },
        { title: "Subscriptions", url: "/subscriptions", icon: CreditCard, module: "subscriptions" },
      ],
    },
    {
      label: "PROCUREMENT",
      items: [
        { title: "Vendors", url: "/vendors", icon: Building, module: "vendors" },
        { title: "Purchase Requests", url: "/procurement/requests", icon: ShoppingCart, module: "procurement" },
      ],
    },
    {
      label: "NETWORK",
      items: [
        { title: "Overview", url: "/network", icon: Network, module: "network" },
        { title: "Devices", url: "/network/devices", icon: HardDrive, module: "network" },
        { title: "Discovery", url: "/network/discovery", icon: Radar, module: "network" },
        { title: "Topology", url: "/network/topology", icon: Share2, module: "network" },
        { title: "IP Manager", url: "/network/ip-manager", icon: Globe, module: "network" },
        { title: "Rack View", url: "/network/rack-view", icon: Server, module: "network" },
      ],
    },
    {
      label: "KNOWLEDGE BASE",
      items: [
        { title: "Home", url: "/kb", icon: BookOpen, module: "kb" },
        { title: "All Articles", url: "/kb/articles", icon: FileText, module: "kb" },
      ],
    },
    {
      label: "VAULT",
      items: [
        { title: "Password Vault", url: "/vault/passwords", icon: KeyRound, module: "vault" },
        { title: "Shared with Me", url: "/vault/shared", icon: Share2, module: "vault" },
        { title: "Account Workspaces", url: "/vault/workspaces", icon: Shield, module: "vault" },
      ],
    },
    {
      label: "FINANCE",
      items: [
        { title: "Budget", url: "/finance/budget", icon: Wallet, module: "finance" },
      ],
    },
    {
      label: "TRANSACTIONS",
      items: [
        { title: "Income", url: "/finance/income", icon: ArrowDownCircle, module: "finance" },
        { title: "Expenses", url: "/finance/expenses", icon: ArrowUpCircle, module: "finance" },
        { title: "Recurring Bills", url: "/finance/recurring-bills", icon: ReceiptText, module: "finance" },
        { title: "Cost Overview", url: "/finance/cost-overview", icon: ChartBar, module: "finance" },
      ],
    },
    {
      label: "REPORTS",
      items: [
        { title: "All Reports", url: "/reports", icon: ChartBar, module: "reports" },
        { title: "Master Report", url: "/reports/master", icon: ClipboardList, module: "reports" },
        { title: "Financial", url: "/reports/financial", icon: Wallet, module: "reports" },
        { title: "Assets", url: "/reports/assets", icon: Box, module: "reports" },
        { title: "Helpdesk", url: "/reports/helpdesk", icon: Headset, module: "reports" },
        { title: "Licenses", url: "/reports/licenses", icon: KeyRound, module: "reports" },
        { title: "Procurement", url: "/reports/procurement", icon: ShoppingCart, module: "reports" },
        { title: "Vendors", url: "/reports/vendors", icon: Building, module: "reports" },
        { title: "Seating", url: "/reports/seating", icon: Map, module: "reports" },
        { title: "Network", url: "/reports/network", icon: Network, module: "reports" },
        { title: "Onboarding", url: "/reports/onboarding", icon: UserPlus, module: "reports" },
        { title: "Knowledge Base", url: "/reports/kb", icon: BookOpen, module: "reports" },
        { title: "People", url: "/reports/users", icon: Users, module: "reports" },
      ],
    },
    {
      label: "HELPDESK",
      items: [
        { title: "Dashboard", url: "/helpdesk", icon: Headset, module: "helpdesk" },
        { title: "All Tickets", url: "/helpdesk/tickets", icon: TicketCheck, module: "helpdesk" },
        { title: "My Tickets", url: "/helpdesk/my-tickets", icon: ListTodo, module: "helpdesk" },
      ],
    },
    {
      label: "SYSTEM",
      roles: ["ADMIN", "SUPERADMIN"],
      items: [
        { title: "Master Settings", url: "/settings", icon: Settings, module: "settings" },
        { title: "Audit Logs", url: "/settings/audit-log", icon: Activity, module: "settings" },
      ],
    },
  ]

  const filteredNavGroups = navGroups.map(group => {
    // Admin-only groups still gate by explicit role list.
    if (group.roles && (!user || !group.roles.includes(user.role))) return null;
    // Otherwise keep only the items this role can view.
    const items = group.items.filter((item: any) => can(user, item.module, "view"));
    if (items.length === 0) return null;
    return { ...group, items };
  }).filter(Boolean);

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      {/* Edge Toggle Button */}
      <Button
        variant="outline"
        size="icon"
        onClick={toggleSidebar}
        className="absolute -right-3 top-6 z-50 h-6 w-6 rounded-full p-0 shadow-sm hidden md:flex items-center justify-center bg-background border-border hover:bg-muted"
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </Button>

      {/* Sidebar Background Elements */}
      <BackgroundBlobs variant="sidebar" />

      <SidebarContent className="relative z-10">

        {filteredNavGroups.map((group: any) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] font-semibold text-muted-foreground/70 tracking-widest uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item: any) => {
                  const isActive = pathname === item.url || (item.url !== "/dashboard" && pathname.startsWith(item.url))
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={isActive}
                        tooltip={item.title}
                        className={isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/70 hover:text-sidebar-foreground"}
                      >
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="relative z-10 border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:justify-center">
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout()}
                className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                title="Log out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{user?.full_name || "User"} — Click to logout</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={user?.avatar || undefined} alt={user?.full_name} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                {user?.full_name?.charAt(0) || <UserIcon className="h-3 w-3" />}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium leading-none mb-0.5 truncate">
                {user?.full_name || user?.email}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">{user?.role}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

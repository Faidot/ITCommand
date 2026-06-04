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
  Receipt,
  PiggyBank,
  FileSpreadsheet,
  Banknote,
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
  Globe,
  BookOpen,
  Share2,
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
        { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "PEOPLE",
      items: [
        { title: "Users", url: "/users", icon: Users },
        { title: "Departments", url: "/departments", icon: Building },
        { title: "Onboarding", url: "/onboarding", icon: UserPlus },
        { title: "Seating Plan", url: "/seating", icon: Map },
      ],
    },
    {
      label: "ASSETS",
      items: [
        { title: "Asset Inventory", url: "/assets", icon: Box },
        { title: "Asset Notes", url: "/asset-notes", icon: FileText },
        { title: "Software Licenses", url: "/licenses", icon: KeyRound },
      ],
    },
    {
      label: "PROCUREMENT",
      items: [
        { title: "Vendors", url: "/vendors", icon: Building },
        { title: "Purchase Requests", url: "/procurement/requests", icon: ShoppingCart },
      ],
    },
    {
      label: "NETWORK",
      items: [
        { title: "Overview", url: "/network", icon: Network },
        { title: "Devices", url: "/network/devices", icon: HardDrive },
        { title: "IP Manager", url: "/network/ip-manager", icon: Globe },
        { title: "Rack View", url: "/network/rack-view", icon: Server },
      ],
    },
    {
      label: "KNOWLEDGE BASE",
      items: [
        { title: "Home", url: "/kb", icon: BookOpen },
        { title: "All Articles", url: "/kb/articles", icon: FileText },
      ],
    },
    {
      label: "VAULT",
      items: [
        { title: "Password Vault", url: "/vault/passwords", icon: KeyRound },
        { title: "Shared with Me", url: "/vault/shared", icon: Share2 },
        { title: "Account Workspaces", url: "/vault/workspaces", icon: Shield },
      ],
    },
    {
      label: "FINANCE",
      items: [
        { title: "Budget", url: "/finance/budget", icon: Wallet },
        { title: "Expenses", url: "/finance/expenses", icon: Receipt },
        { title: "Petty Cash", url: "/finance/petty-cash", icon: PiggyBank },
        { title: "Recurring Bills", url: "/finance/bills", icon: FileSpreadsheet },
        { title: "Payments", url: "/finance/payments", icon: Banknote },
      ],
    },
    {
      label: "REPORTS",
      items: [
        { title: "Financial Reports", url: "/reports/financial", icon: ChartBar },
        { title: "Asset Reports", url: "/reports/assets", icon: LineChart },
      ],
    },
    {
      label: "HELPDESK",
      items: [
        { title: "Dashboard", url: "/helpdesk", icon: Headset },
        { title: "All Tickets", url: "/helpdesk/tickets", icon: TicketCheck },
        { title: "My Tickets", url: "/helpdesk/my-tickets", icon: ListTodo },
      ],
    },
    {
      label: "SYSTEM",
      roles: ["ADMIN", "SUPERADMIN"],
      items: [
        { title: "Master Settings", url: "/settings", icon: Settings },
        { title: "Audit Logs", url: "/settings/audit-log", icon: Activity },
      ],
    },
  ]

  const filteredNavGroups = navGroups.map(group => {
    // Hide Vault for VIEWER
    if (group.label === "VAULT" && user?.role === "VIEWER") return null;
    // Check custom roles if defined
    if (group.roles && (!user || !group.roles.includes(user.role))) return null;
    return group;
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

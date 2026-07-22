"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { Bell, LogOut, Settings, User, Search, SplitSquareHorizontal, Server } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { useSplitScreenStore } from "@/store/splitScreenStore"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuthStore } from "@/store/authStore"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import api from "@/lib/api"
import { toast } from "sonner"

interface AppNotification {
  id: number
  message: string
  notification_type: string
  is_read: boolean
  link?: string | null
  created_at: string
}

function isAppNotification(value: unknown): value is AppNotification {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === "number"
    && typeof item.message === "string"
    && typeof item.notification_type === "string"
    && typeof item.is_read === "boolean"
    && typeof item.created_at === "string"
  )
}

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const { toggleSplit, isSplit } = useSplitScreenStore()

  // Search State
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<any[]>([])

  // Notifications State
  const [notifications, setNotifications] = React.useState<AppNotification[]>([])
  const desktopNotifiedIds = React.useRef<Set<number> | null>(null)
  
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  React.useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setSearchResults([])
    }
  }, [open])

  React.useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        try {
          const res = await api.get(`/search/?q=${encodeURIComponent(searchQuery)}`)
          setSearchResults(res.data)
        } catch (error) {
          console.error("Search failed", error)
        }
      } else {
        setSearchResults([])
      }
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery])

  const fetchNotifications = React.useCallback(async () => {
    if (!user) return;
    try {
      const generateLegacyAlerts = desktopNotifiedIds.current === null
      const res = await api.get(
        generateLegacyAlerts ? '/notifications/' : '/notifications/?generate=false'
      )
      const nextNotifications = Array.isArray(res.data)
        ? res.data.filter(isAppNotification).filter((item) => !item.is_read)
        : []
      setNotifications(nextNotifications)

      const seen = desktopNotifiedIds.current
      if (seen === null) {
        desktopNotifiedIds.current = new Set(nextNotifications.map((item) => item.id))
        return
      }

      if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
        nextNotifications
          .filter((item) => (
            !item.is_read
            && item.notification_type === "SUBSCRIPTION"
            && !seen.has(item.id)
          ))
          .forEach((item) => {
            const desktopNotification = new window.Notification("Subscription reminder", {
              body: item.message,
              icon: "/icon.svg",
              tag: `it-command-subscription-${item.id}`,
            })
            desktopNotification.onclick = () => {
              window.focus()
              if (item.link) window.location.assign(item.link)
              desktopNotification.close()
            }
          })
      }
      nextNotifications.forEach((item) => seen.add(item.id))
    } catch (error) {
      console.error("Failed to load notifications", error)
    }
  }, [user])

  React.useEffect(() => {
    if (!user) {
      setNotifications([])
      desktopNotifiedIds.current = null
      return
    }

    desktopNotifiedIds.current = null
    void fetchNotifications()
    const intervalId = window.setInterval(() => void fetchNotifications(), 60_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchNotifications()
    }
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [fetchNotifications, user])

  const markAsRead = async (id: number, link?: string | null) => {
    try {
      await api.post(`/notifications/${id}/read/`)
      setNotifications((current) => current.filter((notification) => notification.id !== id))
      if (link) {
        router.push(link)
      }
    } catch {
      toast.error("Failed to mark as read")
    }
  }

  const formatTitle = (path: string) => {
    if (path === "/dashboard") return "Dashboard"
    if (path === "/") return "Overview"
    if (path === "/profile") return "Profile"
    const segments = path.split("/").filter(Boolean)
    const lastSegment = segments[segments.length - 1] || ""
    return lastSegment.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  // Group search results by category
  const groupedResults = searchResults.reduce((acc: any, curr: any) => {
    if (!acc[curr.category]) acc[curr.category] = []
    acc[curr.category].push(curr)
    return acc
  }, {})

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/60 backdrop-blur-xl px-4 w-full sticky top-0 z-40 shadow-sm shadow-black/5">
      <div className="flex items-center gap-3 mr-auto">
        {/* Mobile Sidebar Trigger */}
        <div className="flex items-center md:hidden">
          <SidebarTrigger className="-ml-1" />
          <div className="mx-2 h-4 w-[1px] bg-border" />
        </div>

        {/* Brand Logo - Now in global header */}
        <div className="flex items-center gap-2.5 hidden md:flex cursor-pointer" onClick={() => router.push('/dashboard')}>
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 shadow-sm shadow-primary/25">
            <Server className="size-4" />
          </div>
          <span className="font-bold text-base tracking-tight whitespace-nowrap">IT Command</span>
        </div>
        
        <div className="mx-2 h-4 w-[1px] bg-border hidden md:block" />
        
        <h1 className="text-sm font-medium tracking-tight text-muted-foreground">{formatTitle(pathname)}</h1>
      </div>
      
      <div className="flex items-center gap-1.5">
        
        <Button 
          variant="outline" 
          className="relative h-8 w-56 justify-start text-xs text-muted-foreground hidden md:flex rounded-lg border-border/60"
          onClick={() => setOpen(true)}
        >
          <Search className="mr-2 h-3.5 w-3.5" />
          <span>Search...</span>
          <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground relative transition-colors">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
              )}
              <span className="sr-only">Toggle notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
            <DropdownMenuLabel>Notifications ({unreadCount})</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No new notifications</div>
            ) : (
              notifications.map((notif) => (
                <DropdownMenuItem 
                  key={notif.id} 
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                  onSelect={() => markAsRead(notif.id, notif.link)}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-semibold text-xs text-primary">{notif.notification_type}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{new Date(notif.created_at).toLocaleDateString()}</span>
                  </div>
                  <span className="text-sm">{notif.message}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Split Screen Toggle - Desktop only */}
        <Button
          variant="ghost"
          size="icon"
          className={`hidden lg:inline-flex text-muted-foreground hover:text-foreground relative transition-all ${isSplit ? "bg-primary/10 text-primary" : ""}`}
          onClick={toggleSplit}
          title="Toggle Split Screen (Desktop only)"
        >
          <SplitSquareHorizontal className="h-4 w-4" />
        </Button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.avatar || undefined} alt={user?.full_name} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                  {user?.full_name?.charAt(0) || <User className="h-3.5 w-3.5" />}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.full_name || "User"}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onSelect={() => router.push('/profile')}>
              <User className="mr-2 h-4 w-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            {user?.role === "SUPERADMIN" && (
              <DropdownMenuItem className="cursor-pointer" onSelect={() => router.push('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer" onSelect={() => logout()}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 overflow-hidden sm:max-w-xl max-w-[95vw] rounded-xl top-[20%] translate-y-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search the application</DialogDescription>
          <Command shouldFilter={false} className="w-full">
            <CommandInput 
              placeholder="Type a command or search..." 
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {searchQuery.length > 0 && searchResults.length === 0 && (
                <CommandEmpty>No results found.</CommandEmpty>
              )}
              {Object.keys(groupedResults).map((category) => (
                <CommandGroup key={category} heading={category}>
                  {groupedResults[category].map((item: any) => (
                    <CommandItem 
                      key={`${item.category}-${item.id}`}
                      onSelect={() => {
                        setOpen(false)
                        router.push(item.link)
                      }}
                      className="flex flex-col items-start py-2 cursor-pointer"
                    >
                      <span className="font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground">{item.subtitle}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </header>
  )
}

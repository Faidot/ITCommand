"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Building, 
  MoreHorizontal, 
  Plus, 
  Search, 
  UserCircle,
  Copy,
  Check,
  ShieldAlert,
  KeyRound,
  Trash2,
  Undo2
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelection, summarizeBulkDelete } from "@/hooks/use-bulk-selection";

// Types
export interface Department {
  id: number;
  name: string;
}

export interface UserDetail {
  id: number;
  email: string;
  full_name: string;
  role: string;
  department: number | null;
  avatar: string | null;
  designation?: string | null;
  bio?: string | null;
  manager?: number | null;
  manager_name?: string | null;
  team_lead?: number | null;
  team_lead_name?: string | null;
  is_active: boolean;
  created_at: string;
  temp_password?: string;
}

const formSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2),
  role: z.string(),
  department: z.string().optional(),
  designation: z.string().optional(),
  bio: z.string().optional(),
  manager: z.string().optional(),
  team_lead: z.string().optional(),
});

export default function UsersPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [users, setUsers] = useState<UserDetail[]>([]);
  const [userOptions, setUserOptions] = useState<UserDetail[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");

  // Modals
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [copied, setCopied] = useState(false);

  const [editingUser, setEditingUser] = useState<UserDetail | null>(null);

  const sel = useBulkSelection<number>();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const bulkDeactivate = async () => {
    if (sel.count === 0) return;
    if (!confirm(`Deactivate ${sel.count} user(s)? This is a soft delete — their data is preserved.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/users/bulk_delete/", { ids: sel.ids });
      const { deactivated_count, blocked_count, blocked = [] } = res.data;
      if (blocked_count === 0) toast.success(`Deactivated ${deactivated_count} user(s).`);
      else toast(`Deactivated ${deactivated_count}, blocked ${blocked_count}.`);
      if (blocked.length) {
        const sample = blocked.slice(0, 3).map((b: any) => `${b.email || b.id}: ${b.reason}`).join(" · ");
        toast(sample, { duration: 5000 });
      }
      sel.clear();
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Bulk deactivate failed.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      full_name: "",
      role: "VIEWER",
      department: "none",
      designation: "",
      bio: "",
      manager: "none",
      team_lead: "none",
    },
  });

  const fetchDependencies = async () => {
    try {
      const [depts, allUsers] = await Promise.all([
        api.get("/departments/"),
        api.get("/users/"),
      ])
      setDepartments(depts.data);
      setUserOptions(allUsers.data);
    } catch {
      toast.error("Failed to load generic metadata.");
    }
  };

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (roleFilter !== "ALL") params.append("role", roleFilter);
      if (departmentFilter !== "ALL") params.append("department", departmentFilter);

      const res = await api.get(`/users/?${params.toString()}`);
      setUsers(res.data);
    } catch (err) {
      toast.error("Failed to load users.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDependencies();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchUsers();
    }, 400); // 400ms debounce
    return () => clearTimeout(handler);
  }, [searchQuery, roleFilter, departmentFilter]);

  const openAddDialog = () => {
    setEditingUser(null);
    form.reset({ 
      email: "", 
      full_name: "", 
      role: "VIEWER", 
      department: "none",
      designation: "",
      bio: "",
      manager: "none",
      team_lead: "none",
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (u: UserDetail) => {
    setEditingUser(u);
    form.reset({
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      department: u.department ? u.department.toString() : "none",
      designation: u.designation || "",
      bio: u.bio || "",
      manager: u.manager ? u.manager.toString() : "none",
      team_lead: u.team_lead ? u.team_lead.toString() : "none",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const payload = {
        ...values,
        department: values.department === "none" ? null : parseInt(values.department!),
        manager: values.manager && values.manager !== "none" ? parseInt(values.manager) : null,
        team_lead: values.team_lead && values.team_lead !== "none" ? parseInt(values.team_lead) : null,
      };

      if (editingUser) {
        await api.put(`/users/${editingUser.id}/`, payload);
        toast.success("User updated.");
        setIsDialogOpen(false);
      } else {
        const res = await api.post("/users/", payload);
        toast.success("User created.");
        if (res.data.temp_password) {
          setGeneratedPassword(res.data.temp_password);
          setIsPasswordModalOpen(true);
        }
        setIsDialogOpen(false);
      }
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || JSON.stringify(err.response?.data) || "An error occurred.");
    }
  };

  const toggleUserStatus = async (u: UserDetail) => {
    try {
      // If active -> deactivate (soft delete).
      if (u.is_active) {
        await api.delete(`/users/${u.id}/`);
        toast.success("User deactivated.");
      } else {
        // Reactivate via PATCH
        await api.patch(`/users/${u.id}/`, { is_active: true });
        toast.success("User reactivated.");
      }
      fetchUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Action failed.");
    }
  };

  const resetPassword = async (u: UserDetail) => {
    try {
      const res = await api.post(`/users/${u.id}/reset_password/`);
      toast.success("Password arbitrarily reset.");
      if (res.data.temp_password) {
        setGeneratedPassword(res.data.temp_password);
        setIsPasswordModalOpen(true);
      }
    } catch (err: any) {
      toast.error("Failed to reset password.");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleBadgeColor = (role: string) => {
    switch(role) {
      case "SUPERADMIN": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900";
      case "ADMIN": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-900";
      case "MANAGER": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-900";
      default: return "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700";
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto h-full p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-neutral-500">Manage individuals and arbitrary access vectors.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search email or name..."
            className="pl-9 bg-white dark:bg-neutral-900"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[150px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            <SelectItem value="SUPERADMIN">Superadmin</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="MANAGER">Manager</SelectItem>
            <SelectItem value="VIEWER">Viewer</SelectItem>
          </SelectContent>
        </Select>

        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isAdmin && sel.count > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="text-sm"><span className="font-medium">{sel.count}</span> selected</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={sel.clear}>Clear</Button>
            <Button variant="destructive" size="sm" onClick={bulkDeactivate} disabled={bulkDeleting}>
              {bulkDeleting ? "Working…" : `Deactivate ${sel.count}`}
            </Button>
          </div>
        </div>
      )}

      <Card className="flex-1 bg-white dark:bg-neutral-900 overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={sel.allSelected(users.map((u) => u.id)) || (sel.someSelected(users.map((u) => u.id)) ? "indeterminate" : false)}
                    onCheckedChange={() => sel.toggleAll(users.map((u) => u.id))}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 6 : 5} className="text-center py-10 text-neutral-500">
                    Loading users matrix...
                 </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 6 : 5} className="text-center py-10 text-neutral-500">
                    No users correspond to configured filters.
                 </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const dept = departments.find(d => d.id === u.department);
                return (
                <TableRow key={u.id} className={!u.is_active ? "opacity-50" : ""} data-state={sel.isSelected(u.id) ? "selected" : undefined}>
                  {isAdmin && (
                    <TableCell className="w-10">
                      <Checkbox
                        checked={sel.isSelected(u.id)}
                        onCheckedChange={() => sel.toggle(u.id)}
                        aria-label={`Select ${u.full_name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={u.avatar || undefined} />
                        <AvatarFallback className="bg-neutral-100 text-neutral-900 text-xs">
                          {u.full_name?.charAt(0) || <UserCircle className="h-4 w-4" />}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{u.full_name}</span>
                        <span className="text-xs text-neutral-500">{u.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getRoleBadgeColor(u.role)}>
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-neutral-500">
                    {dept?.name || "—"}
                  </TableCell>
                  <TableCell>
                    {u.is_active ? (
                      <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50 dark:border-green-900/50 dark:text-green-400 dark:bg-green-900/20">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="border-neutral-200 text-neutral-600 bg-neutral-100 dark:border-neutral-800 dark:text-neutral-400 dark:bg-neutral-900">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Account Intercepts</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => router.push(`/users/${u.id}`)}>
                          View Full Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTimeout(() => openEditDialog(u), 100)} disabled={!isAdmin}>
                          Edit user context
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTimeout(() => resetPassword(u), 100)} disabled={!isAdmin || !u.is_active}>
                          <KeyRound className="mr-2 h-4 w-4" /> Regenerate credential
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className={u.is_active ? "text-destructive focus:bg-destructive focus:text-destructive-foreground" : ""}
                          onSelect={() => setTimeout(() => toggleUserStatus(u), 100)}
                          disabled={!isAdmin || u.email === user?.email}
                        >
                          {u.is_active ? (
                            <><Trash2 className="mr-2 h-4 w-4" /> Deactivate Account</>
                          ) : (
                            <><Undo2 className="mr-2 h-4 w-4" /> Restore Access</>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </Card>

      {/* CREATE/EDIT USER DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit Profile Mapping" : "Initialize Identity"}</DialogTitle>
            <DialogDescription>
              {editingUser 
                ? "Update arbitrary role constraints or identifiers natively." 
                : "Create an identity overlay. A password will automatically be synthesized safely."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input placeholder="john@itcommand.local" {...field} disabled={!!editingUser} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Permission Scope</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="VIEWER">Viewer</SelectItem>
                          <SelectItem value="MANAGER">Manager</SelectItem>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                          <SelectItem value="SUPERADMIN">Superadmin</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department Hook</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Node attach" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {departments.map(d => (
                            <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="designation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Designation (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Team Lead, SysAdmin..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bio (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Short bio..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="manager"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Manager (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {userOptions.map((u) => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.full_name || u.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="team_lead"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team Lead (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {userOptions.map((u) => (
                            <SelectItem key={u.id} value={u.id.toString()}>
                              {u.full_name || u.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Commit payload</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* GENERATED PASSWORD DISPLAY DIALOG */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" /> Secure Credential Rendered
            </DialogTitle>
            <DialogDescription>
              We successfully synthesized a temporary passcode. This credential will <strong>never</strong> be displayed again natively!
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 mt-4 bg-neutral-100 dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <code className="flex-1 text-sm font-mono tracking-wider">{generatedPassword}</code>
            <Button size="icon" variant="ghost" onClick={copyToClipboard}>
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter className="mt-4">
            <Button onClick={() => setIsPasswordModalOpen(false)}>Acknowledge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

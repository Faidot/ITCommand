"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontal, Plus, Building, Crown, Layers } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelection, summarizeBulkDelete } from "@/hooks/use-bulk-selection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface Department {
  id: number;
  name: string;
  code?: string | null;
  description: string;
  head?: number | null;
  head_name?: string | null;
  parent?: number | null;
  parent_name?: string | null;
  member_count: number;
  created_at: string;
}

interface UserOption {
  id: number;
  full_name: string;
  email: string;
}

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  code: z.string().optional(),
  description: z.string().optional(),
  head: z.string().optional(),
  parent: z.string().optional(),
});

export default function DepartmentsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [deletingDepartment, setDeletingDepartment] = useState<Department | null>(null);

  const sel = useBulkSelection<number>();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const bulkDelete = async () => {
    if (sel.count === 0) return;
    if (!confirm(`Delete ${sel.count} department(s)? Departments with users will be skipped.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/departments/bulk_delete/", { ids: sel.ids });
      const sum = summarizeBulkDelete(res.data);
      if (sum.kind === "success") toast.success(sum.message);
      else toast(sum.message);
      const blocked: any[] = res.data?.blocked || [];
      if (blocked.length) {
        const sample = blocked.slice(0, 3).map((b: any) => `${b.name || b.id}: ${b.reason}`).join(" · ");
        toast(sample, { duration: 5000 });
      }
      sel.clear();
      fetchDepartments();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      head: "none",
      parent: "none",
    },
  });

  const fetchDependencies = async () => {
    try {
      const res = await api.get("/users/");
      setUserOptions(res.data || []);
    } catch {
      // non-blocking
    }
  };

  const fetchDepartments = async () => {
    try {
      setIsLoading(true);
      const res = await api.get("/departments/");
      setDepartments(res.data);
    } catch (err) {
      toast.error("Failed to load departments.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDependencies();
    fetchDepartments();
  }, []);

  const openAddDialog = () => {
    setEditingDepartment(null);
    form.reset({ name: "", code: "", description: "", head: "none", parent: "none" });
    setIsDialogOpen(true);
  };

  const openEditDialog = (dept: Department) => {
    setEditingDepartment(dept);
    form.reset({
      name: dept.name,
      code: dept.code || "",
      description: dept.description || "",
      head: dept.head ? String(dept.head) : "none",
      parent: dept.parent ? String(dept.parent) : "none",
    });
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (dept: Department) => {
    setDeletingDepartment(dept);
    setIsDeleteDialogOpen(true);
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const payload = {
        name: values.name,
        code: values.code?.trim() ? values.code.trim() : null,
        description: values.description || "",
        head: values.head && values.head !== "none" ? parseInt(values.head) : null,
        parent: values.parent && values.parent !== "none" ? parseInt(values.parent) : null,
      };
      if (editingDepartment) {
        await api.put(`/departments/${editingDepartment.id}/`, payload);
        toast.success("Department updated.");
      } else {
        await api.post("/departments/", payload);
        toast.success("Department created.");
      }
      setIsDialogOpen(false);
      fetchDepartments();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "An error occurred.");
    }
  };

  const onDeleteConfirm = async () => {
    if (!deletingDepartment) return;
    try {
      await api.delete(`/departments/${deletingDepartment.id}/`);
      toast.success("Department deleted.");
      setIsDeleteDialogOpen(false);
      fetchDepartments();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "An error occurred.");
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto h-full p-4">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Departments</h1>
          <p className="text-neutral-500">Manage business units and organizational structures.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" /> Add Department
          </Button>
        )}
      </div>

      {isAdmin && sel.count > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="text-sm"><span className="font-medium">{sel.count}</span> selected</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={sel.clear}>Clear</Button>
            <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : `Delete ${sel.count}`}
            </Button>
          </div>
        </div>
      )}

      <Card className="flex-1 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-900 border-b">
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={sel.allSelected(departments.map((d) => d.id)) || (sel.someSelected(departments.map((d) => d.id)) ? "indeterminate" : false)}
                    onCheckedChange={() => sel.toggleAll(departments.map((d) => d.id))}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead className="w-[200px]">Name</TableHead>
              <TableHead className="w-[140px]">Code</TableHead>
              <TableHead className="w-[220px]">Head</TableHead>
              <TableHead className="w-[220px]">Parent</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-[110px]">Members</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-neutral-500">
                    Loading departments...
                 </TableCell>
              </TableRow>
            ) : departments.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-neutral-500">
                    No departments found.
                 </TableCell>
              </TableRow>
            ) : (
              departments.map((dept) => (
                <TableRow key={dept.id} data-state={sel.isSelected(dept.id) ? "selected" : undefined}>
                  {isAdmin && (
                    <TableCell className="w-10">
                      <Checkbox
                        checked={sel.isSelected(dept.id)}
                        onCheckedChange={() => sel.toggle(dept.id)}
                        aria-label={`Select ${dept.name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                       <Building className="h-4 w-4 text-neutral-400" />
                       {dept.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    {dept.code ? (
                      <Badge variant="outline" className="font-mono text-[11px]">{dept.code}</Badge>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {dept.head_name ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {dept.head_name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{dept.head_name}</span>
                        <Crown className="h-3.5 w-3.5 text-amber-500" />
                      </div>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {dept.parent_name ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        <span>{dept.parent_name}</span>
                      </div>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-neutral-500">{dept.description || "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{dept.member_count}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setTimeout(() => openEditDialog(dept), 100)} disabled={!isAdmin}>
                          Edit department
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive focus:bg-destructive focus:text-destructive-foreground" 
                          onSelect={() => setTimeout(() => openDeleteDialog(dept), 100)}
                          disabled={!isAdmin}
                        >
                          Delete department
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* CREATE/EDIT DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editingDepartment ? "Edit Department" : "Add Department"}</DialogTitle>
            <DialogDescription>
              {editingDepartment 
                ? "Make changes to the department details here." 
                : "Create a new department linking users to an organizational cluster."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Engineering..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="engineering" className="font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="head"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department Head (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {userOptions.map((u) => (
                            <SelectItem key={u.id} value={String(u.id)}>
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
                  name="parent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent Department (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {departments
                            .filter((d) => !editingDepartment || d.id !== editingDepartment.id)
                            .map((d) => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                {d.name}
                              </SelectItem>
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Core development team..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save changes</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* DELETE DIALOG */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Department</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deletingDepartment?.name}</strong>? This action cannot be undone. Users attached to this department will lose their association.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
             <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
             <Button variant="destructive" onClick={onDeleteConfirm}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

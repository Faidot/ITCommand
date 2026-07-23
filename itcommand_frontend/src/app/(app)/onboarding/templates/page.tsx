"use client";

import { useEffect, useState } from "react";
import { FileText, UserPlus, UserMinus, Building, Pencil, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateTemplateDialog, TemplateDialog } from "./create-template-dialog";

export default function TemplatesListPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.get("/onboarding/templates/");
      setTemplates(res.data.results || res.data);
    } catch {
      toast.error("Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDelete = async (template: any) => {
    if (!confirm(`Delete template "${template.name}" and all its tasks? This cannot be undone.`)) return;
    setDeletingId(template.id);
    try {
      await api.delete(`/onboarding/templates/${template.id}/`);
      toast.success("Template deleted");
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete template");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-violet-500" /> Checklist Templates
          </h1>
          <p className="text-neutral-500">Manage standardized checklists for onboarding and offboarding</p>
        </div>
        <div className="flex items-center gap-2">
          <CreateTemplateDialog onSuccess={fetchTemplates} />
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-800/50">
            <TableRow>
              <TableHead>Template Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="flex justify-center"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></div></div>
                </TableCell>
              </TableRow>
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-neutral-500">
                  No templates found.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((template: any) => (
                <TableRow key={template.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
                  <TableCell className="font-medium">
                    {template.name}
                    <div className="text-xs text-neutral-500 font-normal mt-1 max-w-md truncate">
                      {template.description || "No description provided."}
                    </div>
                  </TableCell>
                  <TableCell>
                    {template.process_type === 'ONBOARDING' ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0 text-[10px]">
                        <UserPlus className="w-3 h-3 mr-1 inline" /> Onboarding
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-800 hover:bg-red-200 border-0 text-[10px]">
                        <UserMinus className="w-3 h-3 mr-1 inline" /> Offboarding
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {template.department_name ? (
                      <span className="flex items-center gap-1 text-sm"><Building className="w-3 h-3 text-neutral-400" /> {template.department_name}</span>
                    ) : (
                      <span className="text-neutral-500 text-xs">All Departments</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{template.items?.length || 0} tasks</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={template.is_active ? "default" : "secondary"} className={template.is_active ? "bg-blue-100 text-blue-800 border-0" : ""}>
                      {template.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing(template)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                        disabled={deletingId === template.id}
                        onClick={() => handleDelete(template)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      <TemplateDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        template={editing}
        onSuccess={() => { setEditing(null); fetchTemplates(); }}
      />
    </div>
  );
}

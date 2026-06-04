"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, UserPlus, UserMinus, Search, Building } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateTemplateDialog } from "./create-template-dialog";

export default function TemplatesListPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <div className="flex justify-center"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></div></div>
                </TableCell>
              </TableRow>
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-neutral-500">
                  No templates found.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((template: any) => (
                <TableRow key={template.id} className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

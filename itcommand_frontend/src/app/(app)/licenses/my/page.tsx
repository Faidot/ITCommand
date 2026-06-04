"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Shield, AlertTriangle } from "lucide-react";
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

const LICENSE_TYPE_BADGE: Record<string, string> = {
  PERPETUAL: "bg-blue-100 text-blue-800",
  SUBSCRIPTION: "bg-violet-100 text-violet-800",
  VOLUME: "bg-amber-100 text-amber-800",
  OEM: "bg-neutral-100 text-neutral-800",
  OPEN_SOURCE: "bg-emerald-100 text-emerald-800",
  TRIAL: "bg-rose-100 text-rose-800",
};

function formatDate(d: string) {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MyLicensesPage() {
  const router = useRouter();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  // We need to fetch for the currently logged-in user.
  // We can get the user ID from the auth endpoint or authStore.
  // Actually, there's no endpoint to directly get "my" licenses unless we use /api/licenses/user/{user_id}/.
  // Let's get the user ID from /auth/me/ first or just rely on a new endpoint if it existed.
  // Wait, I created `/licenses/user/<user_id>/` and `useAuthStore` has user.id.
  
  useEffect(() => {
    const fetchMyLicenses = async () => {
      try {
        const meRes = await api.get("/auth/me/");
        const userId = meRes.data.id;
        const res = await api.get(`/licenses/user/${userId}/`);
        setAssignments(res.data);
      } catch {
        toast.error("Failed to load your licenses.");
      } finally {
        setLoading(false);
      }
    };
    fetchMyLicenses();
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-500" /> My Assigned Licenses
          </h1>
          <p className="text-neutral-500">Software licenses currently assigned to you</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-800/50">
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>License Type</TableHead>
              <TableHead>Assigned Date</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <div className="flex justify-center"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div></div>
                </TableCell>
              </TableRow>
            ) : assignments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-neutral-500 flex flex-col items-center justify-center">
                  <KeyRound className="h-8 w-8 mb-2 opacity-20" />
                  You have no active license assignments.
                </TableCell>
              </TableRow>
            ) : (
              assignments.map((assignment: any) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 font-bold text-neutral-500">
                        {assignment.product_name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{assignment.product_name}</div>
                        <div className="text-xs text-neutral-500">{assignment.product_vendor}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${LICENSE_TYPE_BADGE[assignment.license_type] || "bg-neutral-100"} border-0 text-[10px]`}>
                      {assignment.license_type.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{formatDate(assignment.assigned_date)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-neutral-500 truncate max-w-[200px]" title={assignment.notes}>
                      {assignment.notes || "-"}
                    </div>
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

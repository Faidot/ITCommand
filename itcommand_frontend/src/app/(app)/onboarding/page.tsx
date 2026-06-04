"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserMinus, ListTodo, Calendar, AlertCircle, FileText } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StartOnboardingDialog } from "./start-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function OnboardingDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await api.get("/onboarding/dashboard/");
      setData(res.data);
    } catch {
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const renderRecordCard = (record: any) => (
    <div 
      key={record.id} 
      className="p-4 border rounded-lg hover:border-violet-300 transition-colors cursor-pointer bg-white dark:bg-neutral-900"
      onClick={() => router.push(`/onboarding/${record.id}`)}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={record.employee_avatar} />
            <AvatarFallback>{record.employee_name?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold text-sm">{record.employee_name}</div>
            <div className="text-xs text-neutral-500">{record.template_name}</div>
          </div>
        </div>
        <Badge variant={record.status === 'IN_PROGRESS' ? 'default' : 'secondary'} className={record.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-0' : ''}>
          {record.status.replace('_', ' ')}
        </Badge>
      </div>

      <div className="space-y-1 mt-4">
        <div className="flex justify-between text-xs text-neutral-500">
          <span>{record.progress_stats?.completed || 0} / {record.progress_stats?.total || 0} tasks completed</span>
          <span>{record.progress_stats?.percentage || 0}%</span>
        </div>
        <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-1.5">
          <div 
            className="bg-violet-500 h-1.5 rounded-full" 
            style={{ width: `${record.progress_stats?.percentage || 0}%` }}
          ></div>
        </div>
      </div>

      <div className="flex justify-between items-center mt-4 pt-3 border-t text-xs text-neutral-500">
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          Target: {record.target_completion_date || "Not set"}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListTodo className="h-6 w-6 text-violet-500" /> Onboarding & Offboarding
          </h1>
          <p className="text-neutral-500">Manage employee transition checklists and tasks</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/onboarding/templates")}>
            <FileText className="mr-2 h-4 w-4" /> Templates
          </Button>
          <StartOnboardingDialog onSuccess={fetchDashboard} processType="OFFBOARDING" />
          <StartOnboardingDialog onSuccess={fetchDashboard} processType="ONBOARDING" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Active Onboardings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">{data.active_onboardings.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Active Offboardings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{data.active_offboardings.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Overdue Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{data.overdue_tasks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Completed (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{data.completion_stats?.completed_last_30_days || 0}</div>
            <p className="text-xs text-neutral-500 mt-1">{data.completion_stats?.on_time_rate || 0}% on-time rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-emerald-500" /> Active Onboardings
          </h2>
          {data.active_onboardings.length === 0 ? (
            <div className="text-neutral-500 text-sm p-8 text-center border border-dashed rounded-lg">No active onboardings</div>
          ) : (
            <div className="grid gap-4">
              {data.active_onboardings.map(renderRecordCard)}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <UserMinus className="h-5 w-5 text-red-500" /> Active Offboardings
          </h2>
          {data.active_offboardings.length === 0 ? (
            <div className="text-neutral-500 text-sm p-8 text-center border border-dashed rounded-lg">No active offboardings</div>
          ) : (
            <div className="grid gap-4">
              {data.active_offboardings.map(renderRecordCard)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

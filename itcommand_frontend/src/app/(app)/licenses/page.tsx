"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, CheckCircle2, AlertTriangle, AlertCircle, ArrowRight, Wallet, Users, Box, LayoutDashboard } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

const LICENSE_TYPE_BADGE: Record<string, string> = {
  PERPETUAL: "bg-blue-100 text-blue-800",
  SUBSCRIPTION: "bg-violet-100 text-violet-800",
  VOLUME: "bg-amber-100 text-amber-800",
  OEM: "bg-neutral-100 text-neutral-800",
  OPEN_SOURCE: "bg-emerald-100 text-emerald-800",
  TRIAL: "bg-rose-100 text-rose-800",
};

export default function LicenseDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await api.get("/licenses/dashboard/");
        setData(res.data);
      } catch {
        toast.error("Failed to load licenses dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-violet-500" /> Software Licenses
          </h1>
          <p className="text-neutral-500">Overview of software products, seats, and costs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/licenses/my")}>
            My Licenses
          </Button>
          <Button onClick={() => router.push("/licenses/list")} className="bg-violet-600 hover:bg-violet-700">
            View All Licenses
          </Button>
        </div>
      </div>

      {/* Alert Banner */}
      {data.expired.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded-md flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Action Required: Expired Licenses</h3>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
              You have {data.expired.length} license(s) that have expired. Please review them immediately.
            </p>
          </div>
          <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-100" onClick={() => router.push("/licenses/list?status=expired")}>
            Review
          </Button>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Total Products</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{data.total_products}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-violet-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Total Licenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-violet-600 dark:text-violet-400">{data.total_licenses}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider flex items-center gap-1">
              Expiring Soon (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{data.expiring_within_30_days.length}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Annual Cost (PKR)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              Rs {data.total_annual_cost.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Near Capacity Licenses */}
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Near Capacity (&ge; 80% used)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ScrollArea className="h-72">
              {data.near_capacity.length === 0 ? (
                <div className="text-center text-neutral-500 py-10">No licenses near capacity</div>
              ) : (
                <div className="space-y-4">
                  {data.near_capacity.map((lic: any) => (
                    <div key={lic.id} className="p-3 border rounded-lg hover:border-violet-300 transition-colors cursor-pointer bg-neutral-50 dark:bg-neutral-800/50" onClick={() => router.push(`/licenses/${lic.id}`)}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">{lic.product_name}</div>
                        <Badge variant="outline" className="text-[10px]">{lic.seats_used} / {lic.seats_total} Seats</Badge>
                      </div>
                      <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${lic.seats_usage_pct >= 100 ? 'bg-red-500' : 'bg-amber-500'}`} 
                          style={{ width: `${Math.min(lic.seats_usage_pct, 100)}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-neutral-500 mt-2 text-right">{lic.seats_usage_pct}% Utilized</p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Expiring Soon */}
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-500" /> Expiring within 30 days
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ScrollArea className="h-72">
              {data.expiring_within_30_days.length === 0 ? (
                <div className="text-center text-neutral-500 py-10">No licenses expiring soon</div>
              ) : (
                <div className="space-y-3">
                  {data.expiring_within_30_days.map((lic: any) => (
                    <div key={lic.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer transition-colors" onClick={() => router.push(`/licenses/${lic.id}`)}>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {lic.product_name}
                          <Badge className={`text-[10px] border-0 ${lic.days_until_expiry <= 7 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}`}>
                            {lic.days_until_expiry === 0 ? 'Today' : `${lic.days_until_expiry} days left`}
                          </Badge>
                        </div>
                        <div className="text-xs text-neutral-500 mt-1">Expires: {lic.expiry_date}</div>
                      </div>
                      <Badge className={`${LICENSE_TYPE_BADGE[lic.license_type] || "bg-neutral-100"} text-[10px] border-0`}>
                        {lic.license_type.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

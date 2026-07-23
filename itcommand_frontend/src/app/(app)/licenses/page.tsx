"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, AlertTriangle, AlertCircle, CreditCard } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMoney, useCurrencyCode } from "@/lib/currency";
import SubscriptionsPage from "../subscriptions/page";
import { LayoutDashboard, CalendarClock } from "lucide-react";

const LICENSE_TYPE_BADGE: Record<string, string> = {
  PERPETUAL: "bg-blue-100 text-blue-800",
  SUBSCRIPTION: "bg-violet-100 text-violet-800",
  VOLUME: "bg-amber-100 text-amber-800",
  OEM: "bg-neutral-100 text-neutral-800",
  OPEN_SOURCE: "bg-emerald-100 text-emerald-800",
  TRIAL: "bg-rose-100 text-rose-800",
};

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** Tabbed shell: a combined overview, Software Licenses, and Subscriptions. */
function SoftwareTabs() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("tab");
  const [tab, setTab] = useState(
    initial === "subscriptions" ? "subscriptions" : initial === "licenses" ? "licenses" : "overview"
  );

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <h1 className="text-2xl font-bold tracking-tight mb-3">Software &amp; Subscriptions</h1>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview"><LayoutDashboard className="h-4 w-4 mr-1.5" /> Overview</TabsTrigger>
            <TabsTrigger value="licenses"><KeyRound className="h-4 w-4 mr-1.5" /> Licenses</TabsTrigger>
            <TabsTrigger value="subscriptions"><CreditCard className="h-4 w-4 mr-1.5" /> Subscriptions</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <SoftwareOverview onGoTo={setTab} />
          </TabsContent>
          <TabsContent value="licenses" className="mt-4">
            <LicenseDashboard />
          </TabsContent>
          <TabsContent value="subscriptions" className="mt-0">
            <Suspense fallback={<Spinner />}>
              <SubscriptionsPage />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Unified snapshot across licenses + subscriptions: total software spend, key
 * counts, and one merged "upcoming renewals" list so nothing lapses unnoticed.
 */
function SoftwareOverview({ onGoTo }: { onGoTo: (tab: string) => void }) {
  const money = useMoney();
  const currencyCode = useCurrencyCode();
  const router = useRouter();
  const [lic, setLic] = useState<any>(null);
  const [sub, setSub] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/licenses/dashboard/").then((r) => r.data).catch(() => null),
      api.get("/subscriptions/dashboard/?days=30").then((r) => r.data).catch(() => null),
    ]).then(([l, s]) => { setLic(l); setSub(s); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const licAnnual = Number(lic?.total_annual_cost || 0);
  const subAnnual = Number(sub?.converted?.yearly_spend || 0);
  const combinedAnnual = licAnnual + subAnnual;
  const combinedMonthly = combinedAnnual / 12;
  const combinedDaily = combinedAnnual / 365;

  const renewals = [
    ...((lic?.expiring_within_30_days || []) as any[]).map((l) => ({
      kind: "License", id: l.id, name: l.product_name,
      date: l.expiry_date, days: l.days_until_expiry, href: `/licenses/${l.id}`,
    })),
    ...((sub?.upcoming_renewals || []) as any[]).map((s) => ({
      kind: "Subscription", id: s.id, name: s.name,
      date: s.expiry_date, days: s.days_until_expiry, href: `/subscriptions/${s.id}`,
    })),
  ].sort((a, b) => (a.days ?? 999) - (b.days ?? 999));

  const stat = (label: string, value: React.ReactNode, accent: string) => (
    <Card className={`border-l-4 ${accent}`}>
      <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">{label}</CardTitle></CardHeader>
      <CardContent><div className="text-2xl font-bold tabular-nums">{value}</div></CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Headline: total software spend, per day / month / year */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stat(`Total / day (${currencyCode})`, money(combinedDaily, { decimals: 2 }), "border-l-sky-500")}
        {stat(`Total / month (${currencyCode})`, money(combinedMonthly, { decimals: 0 }), "border-l-blue-500")}
        {stat(`Total / year (${currencyCode})`, money(combinedAnnual, { decimals: 0 }), "border-l-emerald-500")}
        {stat("Renewals next 30d", renewals.length, "border-l-amber-500")}
      </div>

      {/* Licenses vs subscriptions split — monthly & yearly */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-neutral-500 text-xs uppercase tracking-wider flex items-center gap-1 mb-2"><KeyRound className="w-3 h-3" /> Licenses</div>
          <div className="flex items-end justify-between">
            <div><div className="text-lg font-bold tabular-nums">{money(licAnnual / 12, { decimals: 0 })}<span className="text-xs font-normal text-neutral-500">/mo</span></div><div className="text-xs text-neutral-500">{money(licAnnual, { decimals: 0 })}/yr</div></div>
            <div className="text-right text-xs text-neutral-500">{lic?.total_licenses ?? 0} licenses · {lic?.total_products ?? 0} products</div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-neutral-500 text-xs uppercase tracking-wider flex items-center gap-1 mb-2"><CreditCard className="w-3 h-3" /> Subscriptions</div>
          <div className="flex items-end justify-between">
            <div><div className="text-lg font-bold tabular-nums">{money(Number(sub?.converted?.monthly_spend || 0), { decimals: 0 })}<span className="text-xs font-normal text-neutral-500">/mo</span></div><div className="text-xs text-neutral-500">{money(subAnnual, { decimals: 0 })}/yr</div></div>
            <div className="text-right text-xs text-neutral-500">{sub?.active_count ?? 0} active · {sub?.expired_count ?? 0} expired</div>
          </div>
        </Card>
      </div>

      {/* Quick links */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onGoTo("licenses")}><KeyRound className="w-3.5 h-3.5 mr-1" /> Manage licenses</Button>
        <Button size="sm" variant="outline" onClick={() => onGoTo("subscriptions")}><CreditCard className="w-3.5 h-3.5 mr-1" /> Manage subscriptions</Button>
      </div>

      {/* Merged upcoming renewals */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4 text-amber-500" /> Upcoming renewals (next 30 days)</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {renewals.length === 0 ? (
            <div className="text-center text-neutral-500 py-8">Nothing renews in the next 30 days. 🎉</div>
          ) : (
            <div className="space-y-2">
              {renewals.map((r) => (
                <div key={`${r.kind}-${r.id}`} className="flex items-center justify-between p-3 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer" onClick={() => router.push(r.href)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${r.kind === "License" ? "text-violet-700 border-violet-200" : "text-blue-700 border-blue-200"}`}>{r.kind}</Badge>
                    <span className="font-medium text-sm truncate">{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-neutral-500">{r.date}</span>
                    <Badge className={`text-[10px] border-0 ${(r.days ?? 99) <= 7 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                      {r.days === 0 ? "Today" : `${r.days}d`}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SoftwareSubscriptionsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SoftwareTabs />
    </Suspense>
  );
}

function LicenseDashboard() {
  const money = useMoney();
  const currencyCode = useCurrencyCode();
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

  if (loading) return <Spinner />;

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <p className="text-neutral-500">Overview of software products, seats, and costs</p>
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
            <CardTitle className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Annual Cost ({currencyCode})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {money(data.total_annual_cost, { decimals: 0 })}
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

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Building, Calendar, Mail, ShieldAlert, Power, Undo2, KeyRound } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuthStore } from "@/store/authStore";

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPERADMIN";
  const [user, setUser] = useState<any>(null);
  const [seat, setSeat] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isSelf = currentUser?.id === user?.id;

  const toggleStatus = async () => {
    if (!user) return;
    if (user.is_active) {
      if (!confirm(`Deactivate ${user.full_name}? They will lose access until reactivated.`)) return;
      setBusy(true);
      try {
        await api.delete(`/users/${user.id}/`);
        toast.success("User deactivated.");
        fetchUserData();
      } catch (err: any) {
        toast.error(err.response?.data?.detail || "Failed to deactivate.");
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(true);
      try {
        await api.patch(`/users/${user.id}/`, { is_active: true });
        toast.success("User reactivated.");
        fetchUserData();
      } catch (err: any) {
        toast.error(err.response?.data?.detail || "Failed to reactivate.");
      } finally {
        setBusy(false);
      }
    }
  };

  const resetPassword = async () => {
    if (!user) return;
    if (!confirm(`Reset password for ${user.full_name}? A new temporary password will be generated.`)) return;
    setBusy(true);
    try {
      const res = await api.post(`/users/${user.id}/reset_password/`);
      toast.success("Password reset.");
      if (res.data?.temp_password) {
        prompt("Temporary password (copy now — won't be shown again):", res.data.temp_password);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to reset password.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    fetchUserData();
  }, [params.id]);

  const fetchUserData = async () => {
    try {
      const [userRes, seatRes] = await Promise.all([
        api.get(`/users/${params.id}/`),
        api.get(`/seating/users/${params.id}/seat/`).catch(() => ({ data: null }))
      ]);
      setUser(userRes.data);
      setSeat(seatRes.data);
    } catch {
      toast.error("Failed to load user data");
      router.push("/users");
    } finally {
      setLoading(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-4 pb-6 border-b">
        <Button variant="ghost" size="icon" onClick={() => router.push("/users")}>
          <ArrowLeft className="h-5 w-5 text-neutral-500" />
        </Button>
        <Avatar className="h-16 w-16 shadow-sm">
          <AvatarImage src={user.avatar} />
          <AvatarFallback className="text-xl bg-violet-100 text-violet-700 font-bold">
            {user.full_name?.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{user.full_name}</h1>
          <div className="text-neutral-500 text-sm flex items-center gap-4 mt-1">
            <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {user.email}</span>
            <Badge variant="outline">{user.role}</Badge>
            {user.is_active ? (
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0">Active</Badge>
            ) : (
              <Badge className="bg-neutral-100 text-neutral-600 border-0">Inactive</Badge>
            )}
          </div>
        </div>
        {isAdmin && !isSelf && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={resetPassword} disabled={busy || !user.is_active}>
              <KeyRound className="w-4 h-4 mr-2" /> Reset password
            </Button>
            {user.is_active ? (
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={toggleStatus}
                disabled={busy}
              >
                <Power className="w-4 h-4 mr-2" /> Deactivate
              </Button>
            ) : (
              <Button variant="outline" onClick={toggleStatus} disabled={busy}>
                <Undo2 className="w-4 h-4 mr-2" /> Reactivate
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-neutral-500 mb-1">Full Name</div>
                  <div className="font-medium">{user.full_name}</div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-1">Email</div>
                  <div className="font-medium">{user.email}</div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-1 flex items-center gap-1"><ShieldAlert className="w-4 h-4" /> System Role</div>
                  <div className="font-medium">{user.role}</div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-1 flex items-center gap-1"><Calendar className="w-4 h-4" /> Joined</div>
                  <div className="font-medium">{new Date(user.created_at).toLocaleDateString()}</div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-1">Designation</div>
                  <div className="font-medium">{user.designation || "—"}</div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-1">Manager</div>
                  <div className="font-medium">{user.manager_name || "—"}</div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-1">Team Lead</div>
                  <div className="font-medium">{user.team_lead_name || "—"}</div>
                </div>
              </div>

              {user.bio && (
                <div className="pt-2">
                  <div className="text-neutral-500 mb-1">Bio</div>
                  <div className="whitespace-pre-wrap">{user.bio}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Seating Widget */}
          <Card className="border-violet-200 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-violet-500"></div>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-violet-500" /> Current Seat
              </CardTitle>
            </CardHeader>
            <CardContent>
              {seat && seat.seat ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-2xl font-black tracking-tight text-neutral-800 dark:text-neutral-100">
                      {seat.seat_code || "Unknown"}
                    </div>
                    {/* Note: In a real app we'd fetch the floor/office names via expanded serializer, 
                        assuming the API doesn't expand them we show basic info or link to map */}
                  </div>
                  <div className="text-xs text-neutral-500">
                    Assigned on {new Date(seat.assigned_date).toLocaleDateString()}
                  </div>
                  <Button className="w-full mt-2 bg-violet-600 hover:bg-violet-700" size="sm" onClick={() => router.push("/seating")}>
                    Reassign Seat
                  </Button>
                </div>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <div className="text-sm text-neutral-500">No seat assigned</div>
                  <Button className="w-full bg-violet-600 hover:bg-violet-700" size="sm" onClick={() => router.push("/seating")}>
                    Assign Seat
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

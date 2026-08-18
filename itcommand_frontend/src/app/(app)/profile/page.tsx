"use client";

import { useEffect, useMemo, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, Lock, Save, Upload, Building2, ShieldCheck, Briefcase, Users } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const profileSchema = z.object({
  full_name: z.string().min(2, "Name is too short"),
  designation: z.string().optional(),
  bio: z.string().optional(),
});

const passwordSchema = z.object({
  old_password: z.string().min(1, "Required"),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
  confirm_password: z.string().min(1, "Required"),
}).refine(data => data.new_password === data.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"]
});

export default function ProfilePage() {
  const { user, loadFromStorage } = useAuthStore();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const joinedLabel = useMemo(() => {
    if (!user?.created_at) return null;
    try {
      return new Date(user.created_at).toLocaleDateString();
    } catch {
      return null;
    }
  }, [user?.created_at]);

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: user?.full_name || "",
      designation: user?.designation || "",
      bio: user?.bio || "",
    }
  });

  useEffect(() => {
    if (!user) return;
    profileForm.reset({
      full_name: user.full_name || "",
      designation: user.designation || "",
      bio: user.bio || "",
    });
  }, [user, profileForm]);

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      old_password: "",
      new_password: "",
      confirm_password: "",
    }
  });

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      setAvatarPreview((previous) => {
        // Each pick allocates a new object URL. Without releasing the last
        // one, picking through a folder of photos holds every image in memory
        // until the tab is closed.
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
    }
  };

  const onProfileSubmit = async (values: z.infer<typeof profileSchema>) => {
    try {
      const isDirty = profileForm.formState.isDirty;
      if (!isDirty && !avatarFile) {
        toast.message("No changes to save");
        return;
      }

      const formData = new FormData();
      formData.append("full_name", values.full_name);
      if (values.designation !== undefined) formData.append("designation", values.designation);
      if (values.bio !== undefined) formData.append("bio", values.bio);
      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }

      // Pass undefined Content-Type so axios drops the instance-default application/json
      // and the browser sets multipart/form-data with the correct boundary for FormData.
      await api.put('/auth/profile/', formData, {
        headers: { 'Content-Type': undefined as unknown as string }
      });
      
      toast.success("Profile updated successfully");
      await loadFromStorage(); // Refresh user data in store
      setAvatarFile(null);
      setAvatarPreview(null);
      profileForm.reset(values);
    } catch {
      toast.error("Failed to update profile");
    }
  };

  const onPasswordSubmit = async (values: z.infer<typeof passwordSchema>) => {
    try {
      await api.post('/auth/password/', {
        old_password: values.old_password,
        new_password: values.new_password
      });
      toast.success("Password changed successfully");
      passwordForm.reset();
    } catch (err: any) {
      if (err.response?.data?.old_password) {
        passwordForm.setError("old_password", { message: err.response.data.old_password[0] });
      } else {
        toast.error("Failed to change password");
      }
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border bg-card/50 backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
        <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20 ring-4 ring-background shadow-sm">
              <AvatarImage src={avatarPreview || user.avatar || undefined} />
              <AvatarFallback className="text-2xl">
                {user.full_name?.charAt(0) || user.email.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{user.full_name}</h1>
              <div className="text-sm text-muted-foreground truncate">{user.email}</div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {user.role}
                </Badge>
                {user.designation ? (
                  <Badge variant="outline" className="gap-1">
                    <Briefcase className="h-3 w-3" />
                    {user.designation}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <Briefcase className="h-3 w-3" />
                    No designation
                  </Badge>
                )}
                {joinedLabel && (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <User className="h-3 w-3" />
                    Joined {joinedLabel}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="sm:ml-auto flex flex-col sm:items-end gap-2">
            <input
              type="file"
              id="avatar"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <label
              htmlFor="avatar"
              className="cursor-pointer inline-flex items-center justify-center gap-2 text-sm border rounded-xl px-4 py-2 hover:bg-muted/50 transition-colors font-medium"
            >
              <Upload className="w-4 h-4" /> Change photo
            </label>
            {(avatarPreview || avatarFile) && (
              <Button
                type="button"
                variant="ghost"
                className="h-9 px-3 text-xs text-muted-foreground"
                onClick={() => {
                  setAvatarFile(null);
                  setAvatarPreview(null);
                }}
              >
                Reset photo
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="w-full justify-start rounded-2xl bg-muted/50">
          <TabsTrigger value="profile" className="rounded-xl">Profile</TabsTrigger>
          <TabsTrigger value="security" className="rounded-xl">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="m-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main editable profile */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Profile details</CardTitle>
                <CardDescription>Update your public details shown across the app.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...profileForm}>
                  <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-5">
                    <FormField control={profileForm.control} name="full_name" render={({field}) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={profileForm.control} name="designation" render={({field}) => (
                      <FormItem>
                        <FormLabel>Designation (Optional)</FormLabel>
                        <FormControl><Input placeholder="Team Lead, SysAdmin..." {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={profileForm.control} name="bio" render={({field}) => (
                      <FormItem>
                        <FormLabel>Bio (Optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="A short bio..." className="min-h-28" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <FormLabel>Email</FormLabel>
                        <Input value={user.email} disabled className="bg-muted/30" />
                        <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
                      </div>
                      <div className="space-y-1">
                        <FormLabel>Role</FormLabel>
                        <Input value={user.role} disabled className="bg-muted/30 font-mono text-xs" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          profileForm.reset({
                            full_name: user.full_name || "",
                            designation: user.designation || "",
                            bio: user.bio || "",
                          });
                          setAvatarFile(null);
                          setAvatarPreview(null);
                        }}
                      >
                        Reset
                      </Button>
                      <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                        <Save className="w-4 h-4 mr-2"/> Save changes
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* Org snapshot */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Organization
                </CardTitle>
                <CardDescription>Reporting lines and context.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" /> Manager
                  </div>
                  <div className="font-medium">{user.manager_name || "—"}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" /> Team Lead
                  </div>
                  <div className="font-medium">{user.team_lead_name || "—"}</div>
                </div>
                <div className="rounded-2xl border bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">Tip</div>
                  <div className="text-sm">
                    Manager/Team Lead are usually maintained by admins in <span className="font-medium">Users</span>.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="security" className="m-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Change password</CardTitle>
                <CardDescription>Use a strong password unique to this account.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...passwordForm}>
                  <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                    <FormField control={passwordForm.control} name="old_password" render={({field}) => (
                      <FormItem>
                        <FormLabel>Current Password</FormLabel>
                        <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={passwordForm.control} name="new_password" render={({field}) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={passwordForm.control} name="confirm_password" render={({field}) => (
                      <FormItem>
                        <FormLabel>Confirm New Password</FormLabel>
                        <FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <div className="flex items-center justify-end pt-1">
                      <Button type="submit" variant="secondary" disabled={passwordForm.formState.isSubmitting}>
                        <Lock className="w-4 h-4 mr-2"/> Update Password
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Security tips</CardTitle>
                <CardDescription>Quick best practices.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div>Use 12+ characters.</div>
                <div>Avoid reusing passwords.</div>
                <div>Change it if you suspect compromise.</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

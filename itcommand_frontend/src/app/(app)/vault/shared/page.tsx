"use client";

import { useEffect, useState } from "react";
import {
  Share2, Eye, EyeOff, Copy, Loader2, Lock, ShieldCheck, KeySquare, Inbox,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PersonalVaultGate } from "@/components/vault/personal-vault-gate";

interface SharedItem {
  id: number;            // share id
  credential_id: number;
  title: string;
  username: string;
  url: string | null;
  category: string;
  notes: string | null;
  has_totp: boolean;
  shared_by_name: string;
  created_at: string;
  last_revealed_at: string | null;
  reveal_count: number;
}

interface RevealedSecret {
  password: string;
  totp_secret: string | null;
  recovery_codes: string[];
  custom_fields: Record<string, string>;
}

const REVEAL_HIDE_MS = 15_000;

export default function SharedWithMePage() {
  const { user } = useAuthStore();
  const allowed = user?.role && ["MANAGER", "ADMIN", "SUPERADMIN"].includes(user.role);

  if (!allowed) {
    return <div className="p-8 text-center text-red-500">Access Denied. Manager privileges or higher required.</div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto h-full p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Share2 className="w-6 h-6 text-blue-600" /> Shared with Me
        </h1>
        <p className="text-neutral-500">
          Credentials other people have shared privately with you. Only you can open them, using your personal vault password.
        </p>
      </div>

      <PersonalVaultGate>
        <SharedList />
      </PersonalVaultGate>
    </div>
  );
}

function SharedList() {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [loading, setLoading] = useState(true);

  // reveal dialog state
  const [revealTarget, setRevealTarget] = useState<SharedItem | null>(null);
  const [personalPwd, setPersonalPwd] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState<{ [credId: number]: RevealedSecret }>({});

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await api.get("/vault/credentials/shared_with_me/");
      setItems(res.data || []);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to load shared items.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, []);

  const submitReveal = async () => {
    if (!revealTarget) return;
    setRevealing(true);
    try {
      const res = await api.post(`/vault/credentials/${revealTarget.credential_id}/reveal_shared/`, {
        personal_password: personalPwd,
      });
      const credId = revealTarget.credential_id;
      setRevealed((prev) => ({ ...prev, [credId]: res.data }));
      setRevealTarget(null);
      setPersonalPwd("");
      // Auto-hide after a short window.
      setTimeout(() => {
        setRevealed((prev) => {
          const n = { ...prev }; delete n[credId]; return n;
        });
      }, REVEAL_HIDE_MS);
      fetchItems();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Could not reveal — check your personal password.");
    } finally {
      setRevealing(false);
    }
  };

  const copy = async (text: string, label: string) => {
    if (await copyText(text)) toast.success(`${label} copied.`);
    else toast.error(`Could not copy the ${label.toLowerCase()}. Select it and copy by hand.`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading shared items…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-neutral-500">
        <Inbox className="w-10 h-10 mx-auto mb-3 text-neutral-300" />
        Nothing has been shared with you yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {items.map((item) => {
        const secret = revealed[item.credential_id];
        return (
          <Card key={item.id} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base truncate">{item.title}</CardTitle>
                <Badge variant="outline" className="text-[10px] shrink-0">{item.category}</Badge>
              </div>
              <p className="text-xs text-neutral-400">Shared by {item.shared_by_name}</p>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <div className="space-y-1">
                <p className="text-xs text-neutral-500 font-medium">Username</p>
                <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border">
                  <span className="text-sm font-mono truncate">{item.username}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void copy(item.username, "Username")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-neutral-500 font-medium">Password</p>
                <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border">
                  <span className="text-sm font-mono tracking-widest truncate">
                    {secret ? secret.password : "••••••••"}
                  </span>
                  <div className="flex gap-1">
                    {secret && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => void copy(secret.password, "Password")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => {
                        if (secret) {
                          setRevealed((prev) => { const n = { ...prev }; delete n[item.credential_id]; return n; });
                        } else {
                          setRevealTarget(item);
                        }
                      }}>
                      {secret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </div>

              {secret?.totp_secret && (
                <div className="space-y-1">
                  <p className="text-xs text-neutral-500 font-medium flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> TOTP secret</p>
                  <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border">
                    <span className="text-sm font-mono truncate">{secret.totp_secret}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void copy(secret.totp_secret!, "TOTP secret")}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {secret?.recovery_codes?.length ? (
                <div className="space-y-1">
                  <p className="text-xs text-neutral-500 font-medium flex items-center gap-1"><KeySquare className="w-3 h-3" /> Recovery codes</p>
                  <div className="bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border font-mono text-xs space-y-0.5">
                    {secret.recovery_codes.map((rc, i) => <div key={i} className="truncate">{rc}</div>)}
                  </div>
                </div>
              ) : null}

              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline truncate block">
                  {item.url}
                </a>
              )}

              {!secret && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setRevealTarget(item)}>
                  <Lock className="w-3.5 h-3.5 mr-1.5" /> Reveal with personal password
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Personal-password prompt */}
      <Dialog open={revealTarget !== null} onOpenChange={(v) => { if (!v) { setRevealTarget(null); setPersonalPwd(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter your personal password</DialogTitle>
            <DialogDescription>
              Decrypts <span className="font-medium">{revealTarget?.title}</span>, which was shared privately with you.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoFocus
            placeholder="Personal vault password"
            value={personalPwd}
            onChange={(e) => setPersonalPwd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && personalPwd && submitReveal()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevealTarget(null); setPersonalPwd(""); }}>Cancel</Button>
            <Button onClick={submitReveal} disabled={revealing || !personalPwd}>
              {revealing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
              Reveal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { landingRoute } from "@/lib/permissions";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Server, ShieldCheck, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  password: z.string().min(1, {
    message: "Password is required.",
  }),
});

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Mailbox-backed accounts sign in in two steps: Dovecot checks the
  // password, then we check a code. IMAP has no second factor of its own,
  // which is the whole reason this step exists.
  const [challenge, setChallenge] = useState<{
    ticket: string;
    email: string;
    enrolling: boolean;
    secret?: string;
    uri?: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      const response = await api.post("/auth/login/", {
        email: values.email,
        password: values.password,
      });

      // A mailbox account gets a challenge, not tokens. Reading `access` off
      // this response would hand undefined to setAuth and sign nobody in.
      if (response.data.mfa_required) {
        setChallenge({
          ticket: response.data.ticket,
          email: values.email,
          enrolling: Boolean(response.data.enrolment_required),
          secret: response.data.totp_secret,
          uri: response.data.otpauth_uri,
        });
        setIsLoading(false);
        return;
      }

      const { user, access, refresh } = response.data;
      setAuth(user, access, refresh);
      toast.success("Successfully logged in");
      // Not always /dashboard: that page needs the `dashboard` module, and a
      // role without it landed on "Access Denied" every time it signed in.
      router.push(landingRoute(user));
    } catch (error) {
      console.error(error);
      const err = error as { response?: { data?: { detail?: string } } };
      const message = err.response?.data?.detail || "Invalid email or password";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function submitCode() {
    if (!challenge) return;
    setIsLoading(true);
    try {
      const response = await api.post("/auth/mfa/", {
        ticket: challenge.ticket,
        code: code.trim(),
        email: challenge.email,
      });
      const { user, access, refresh } = response.data;

      // Shown exactly once, and only at enrolment. We keep hashes, so there
      // is no second chance to display these.
      if (response.data.recovery_codes) {
        setRecoveryCodes(response.data.recovery_codes);
        setAuth(user, access, refresh);
        setIsLoading(false);
        return;
      }

      setAuth(user, access, refresh);
      toast.success("Successfully logged in");
      router.push(landingRoute(user));
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "That code is not right");
      setCode("");
    } finally {
      setIsLoading(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
          <h1 className="mb-1 text-lg font-semibold">Save your recovery codes</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Each one signs you in once if you lose your phone. They are shown now and
            never again — we only keep hashes of them.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
            {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <Button className="w-full" onClick={() => router.push("/dashboard")}>
            I have saved them
          </Button>
        </div>
      </div>
    );
  }

  if (challenge) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">
              {challenge.enrolling ? "Set up your authenticator" : "Enter your code"}
            </h1>
          </div>

          {challenge.enrolling ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Your password was accepted by the mail server. Add this secret to your
                authenticator app, then enter the six-digit code it shows.
              </p>
              <div className="mb-4 break-all rounded-lg bg-muted p-3 text-center font-mono text-sm">
                {challenge.secret}
              </div>
            </>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">
              Your password was accepted. Enter the six-digit code from your
              authenticator, or one of your recovery codes.
            </p>
          )}

          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submitCode(); }}
            placeholder="123456"
            className="mb-3 text-center font-mono text-lg tracking-widest"
          />
          <Button className="w-full" disabled={isLoading || code.trim().length < 6}
                  onClick={() => void submitCode()}>
            {isLoading ? "Checking…" : "Sign in"}
          </Button>
          <button
            type="button"
            onClick={() => { setChallenge(null); setCode(""); }}
            className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Start again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-background p-4 overflow-hidden">
      {/* Strong Animated Background Blobs */}
      <div 
        className="absolute top-[-15%] left-[-15%] w-[50%] h-[50%] rounded-full animate-float-slow"
        style={{ background: "linear-gradient(135deg, rgba(99,91,255,0.35), rgba(139,92,246,0.25))", filter: "blur(80px)" }}
      />
      <div 
        className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] rounded-full animate-float-slow-reverse"
        style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.3), rgba(99,91,255,0.2))", filter: "blur(80px)" }}
      />
      <div 
        className="absolute top-[30%] right-[5%] w-[35%] h-[35%] rounded-full animate-float-diagonal"
        style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(59,130,246,0.15))", filter: "blur(70px)" }}
      />
      <div 
        className="absolute bottom-[20%] left-[10%] w-[25%] h-[25%] rounded-full animate-float-slow"
        style={{ background: "linear-gradient(135deg, rgba(236,72,153,0.2), rgba(139,92,246,0.15))", filter: "blur(60px)", animationDelay: "5s" }}
      />
      
      {/* Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)", backgroundSize: "24px 24px" }}
      />

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-[420px]">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center justify-center size-12 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Server className="size-6" />
          </div>
          <span className="text-3xl font-bold tracking-tight">IT Command</span>
        </div>

        <div className="bg-card/80 dark:bg-card/60 backdrop-blur-2xl rounded-3xl shadow-2xl shadow-black/5 dark:shadow-black/30 border border-border/50 p-8 transition-all duration-500 hover:shadow-3xl hover:shadow-primary/5">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold tracking-tight mb-2">Welcome back</h1>
            <p className="text-muted-foreground text-sm">Sign in to access your dashboard</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Email</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="admin@itcommand.local" 
                        className="h-11 rounded-xl bg-background/50 border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="h-11 rounded-xl bg-background/50 border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all pr-10"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                          <span className="sr-only">Toggle password visibility</span>
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full mt-2 rounded-xl h-11 text-base font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 active:scale-[0.98] bg-primary hover:bg-primary/90" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in...
                  </span>
                ) : "Sign in"}
              </Button>
            </form>
          </Form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Enterprise IT Management Platform
        </p>
      </div>
    </div>
  );
}

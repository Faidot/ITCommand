"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { AssignSeatDialog } from "../assign-seat-dialog";
import { SubscriptionDialog } from "../subscription-dialog";
import {
  type BudgetCategoryOption,
  type ContractOption,
  type CurrencyOption,
  type DepartmentOption,
  type LicenseOption,
  type Subscription,
  type SubscriptionFormValues,
  type UserOption,
  type VaultCredentialOption,
  type VendorOption,
  formatDate,
  formatMoney,
  listFromResponse,
  normalizeSubscription,
  subscriptionPayload,
} from "../subscription-types";

interface SeatAssignment {
  id: number;
  user: number;
  user_name: string;
  user_email: string;
  user_department: string | null;
  assigned_date: string;
  revoked_date: string | null;
  is_active: boolean;
  notes: string;
  assigned_by_name: string | null;
}

interface Renewal {
  id: number;
  previous_expiry: string | null;
  new_expiry: string;
  cost: string;
  seats_added: number;
  notes: string;
  renewed_by_name: string | null;
  renewed_at: string;
}

interface CardPayment {
  id: number;
  merchant: string;
  amount: string;
  currency: string;
  posted_at: string;
  card: string | null;
  card_label: string;
  match_source: string;
}

interface LinkedExpense {
  id: number;
  title: string;
  amount: string;
  expense_date: string;
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  EXPIRED:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  SCHEDULED:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  PAUSED:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  CANCELLED:
    "border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

function errorDetail(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default function SubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const subscriptionId = params.id as string;
  const { user } = useAuthStore();

  const canEdit = can(user, "subscriptions", "edit");
  const canDelete = can(user, "subscriptions", "delete");

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [assignments, setAssignments] = useState<SeatAssignment[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [expenses, setExpenses] = useState<LinkedExpense[]>([]);
  const [payments, setPayments] = useState<CardPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFlag, setSavingFlag] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [options, setOptions] = useState<{
    users: UserOption[];
    departments: DepartmentOption[];
    vendors: VendorOption[];
    contracts: ContractOption[];
    budgetCategories: BudgetCategoryOption[];
    vaultCredentials: VaultCredentialOption[];
    licenses: LicenseOption[];
    currencies: CurrencyOption[];
  }>({
    users: [],
    departments: [],
    vendors: [],
    contracts: [],
    budgetCategories: [],
    vaultCredentials: [],
    licenses: [],
    currencies: [],
  });

  const [renewOpen, setRenewOpen] = useState(false);
  const [renewForm, setRenewForm] = useState({
    new_expiry: "",
    cost: "",
    seats_added: "",
    notes: "",
  });
  const [suggestedExpiry, setSuggestedExpiry] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);

  const fetchSubscription = useCallback(async () => {
    try {
      const response = await api.get<Record<string, unknown>>(
        `/subscriptions/${subscriptionId}/`,
      );
      const record = normalizeSubscription(response.data);
      if (!record) throw new Error("Malformed subscription payload");
      setSubscription(record);
      setAssignments(listFromResponse<SeatAssignment>(response.data.assignments));
      setRenewals(listFromResponse<Renewal>(response.data.renewals));
      setExpenses(listFromResponse<LinkedExpense>(response.data.expenses));
      setPayments(listFromResponse<CardPayment>(response.data.payments));
    } catch {
      toast.error("Could not load this subscription.");
      router.push("/subscriptions");
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, router]);

  useEffect(() => {
    void fetchSubscription();
  }, [fetchSubscription]);

  useEffect(() => {
    if (!canEdit) return;
    void (async () => {
      try {
        const response = await api.get<Record<string, unknown>>("/subscriptions/options/");
        const data = response.data;
        setOptions({
          users: listFromResponse<UserOption>(data.users),
          departments: listFromResponse<DepartmentOption>(data.departments),
          vendors: listFromResponse<VendorOption>(data.vendors),
          contracts: listFromResponse<ContractOption>(data.contracts),
          budgetCategories: listFromResponse<BudgetCategoryOption>(data.budget_categories),
          vaultCredentials: listFromResponse<VaultCredentialOption>(data.vault_credentials),
          licenses: listFromResponse<LicenseOption>(data.licenses),
          currencies: listFromResponse<CurrencyOption>(data.currencies),
        });
      } catch {
        /* selector data is a nicety; editing still works without it */
      }
    })();
  }, [canEdit]);

  const saveSubscription = async (values: SubscriptionFormValues): Promise<boolean> => {
    try {
      await api.patch(`/subscriptions/${subscriptionId}/`, subscriptionPayload(values));
      toast.success("Subscription updated.");
      await fetchSubscription();
      return true;
    } catch (error) {
      toast.error(errorDetail(error, "Could not save the subscription."));
      return false;
    }
  };

  const toggleAutoRenew = async (next: boolean) => {
    if (!subscription) return;
    setSavingFlag(true);
    try {
      await api.patch(`/subscriptions/${subscriptionId}/`, { auto_renew: next });
      setSubscription({ ...subscription, auto_renew: next });
      toast.success(next ? "Auto-renew enabled." : "Auto-renew disabled.");
    } catch (error) {
      toast.error(errorDetail(error, "Could not update auto-renew."));
    } finally {
      setSavingFlag(false);
    }
  };

  const openRenew = async () => {
    setRenewForm({ new_expiry: "", cost: "", seats_added: "", notes: "" });
    setSuggestedExpiry(null);
    setRenewOpen(true);
    try {
      const response = await api.get<{ suggested_expiry?: string | null }>(
        `/subscriptions/${subscriptionId}/suggest_next_expiry/`,
      );
      const suggested = response.data?.suggested_expiry;
      if (suggested) {
        setSuggestedExpiry(suggested);
        setRenewForm((current) => ({ ...current, new_expiry: suggested }));
      }
    } catch {
      /* non-blocking: the field can still be filled by hand */
    }
  };

  const submitRenew = async () => {
    if (!renewForm.new_expiry) {
      toast.error("A new expiry date is required.");
      return;
    }
    setRenewing(true);
    try {
      const payload: Record<string, unknown> = { new_expiry: renewForm.new_expiry };
      if (renewForm.cost) payload.cost = renewForm.cost;
      if (renewForm.seats_added) payload.seats_added = Number(renewForm.seats_added);
      if (renewForm.notes) payload.notes = renewForm.notes;
      await api.post(`/subscriptions/${subscriptionId}/renew/`, payload);
      toast.success(`Renewed until ${formatDate(renewForm.new_expiry)}.`);
      setRenewOpen(false);
      await fetchSubscription();
    } catch (error) {
      toast.error(errorDetail(error, "Renewal failed."));
    } finally {
      setRenewing(false);
    }
  };

  const revokeSeat = async (userId: number, userName: string) => {
    if (!confirm(`Revoke ${userName}'s seat?`)) return;
    try {
      await api.post(`/subscriptions/${subscriptionId}/revoke/${userId}/`);
      toast.success("Seat revoked.");
      await fetchSubscription();
    } catch (error) {
      toast.error(errorDetail(error, "Could not revoke the seat."));
    }
  };

  const handleDelete = async () => {
    if (!subscription) return;
    if (!confirm(`Delete ${subscription.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/subscriptions/${subscriptionId}/`);
      toast.success("Subscription deleted.");
      router.push("/subscriptions");
    } catch (error) {
      // 409 when active seats remain — the server explains what to do.
      toast.error(errorDetail(error, "Could not delete the subscription."));
    }
  };

  if (loading || !subscription) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const seatsFull =
    subscription.seats_available !== null && subscription.seats_available <= 0;
  const canRenew =
    subscription.billing_cycle === "MONTHLY" || subscription.billing_cycle === "YEARLY";
  const externalUrl = subscription.url ? safeExternalUrl(subscription.url) : null;
  const status = subscription.effective_status || subscription.status;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4">
      <div className="flex flex-wrap items-center gap-4 border-b pb-6">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to subscriptions"
          onClick={() => router.push("/subscriptions")}
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Button>
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-xl font-bold text-muted-foreground">
          {subscription.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{subscription.name}</h1>
            <Badge variant="outline" className={STATUS_STYLES[status] || ""}>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </Badge>
            {subscription.auto_renew && (
              <Badge variant="outline">
                <RefreshCw className="mr-1 h-3 w-3" /> Auto-renew
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {subscription.platform}
            {subscription.plan_type ? ` • ${subscription.plan_type}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && canRenew && (
            <Button onClick={() => void openRenew()}>
              <RotateCcw className="mr-2 h-4 w-4" /> Renew
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void handleDelete()}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <WalletCards className="h-4 w-4" /> Plan &amp; cost
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-y-4">
                <Row label="Category" value={subscription.category} />
                <Row label="Billing cycle" value={subscription.billing_cycle} />
                <Row
                  label="Cost"
                  value={formatMoney(subscription.cost, subscription.currency)}
                />
                <Row
                  label="Annual cost"
                  value={formatMoney(subscription.annual_cost, subscription.currency)}
                />
                <Row label="Starts" value={formatDate(subscription.start_date)} />
                <Row label="Renews" value={formatDate(subscription.expiry_date)} />
              </div>

              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <RefreshCw className="h-3.5 w-3.5" /> Auto-renew
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {subscription.billing_cycle === "MONTHLY"
                      ? "Extends the renewal date by one month each time it lapses."
                      : "Extends the renewal date by one year each time it lapses."}
                  </div>
                </div>
                <Switch
                  checked={subscription.auto_renew}
                  onCheckedChange={(next) => void toggleAutoRenew(next)}
                  disabled={!canEdit || savingFlag}
                />
              </div>

              {externalUrl && (
                <div className="border-t pt-4">
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open service
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <Building2 className="h-4 w-4" /> Ownership &amp; links
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-4">
              <Row label="Owner" value={subscription.owner_name || "Unassigned"} />
              <Row label="Admin" value={subscription.admin_name || "Unassigned"} />
              <Row label="Department" value={subscription.department_name || "None"} />
              <Row label="Team" value={subscription.team || "None"} />
              <Row
                label="Vendor"
                value={
                  subscription.vendor ? (
                    <Link
                      href={`/vendors/${subscription.vendor}`}
                      className="text-primary hover:underline"
                    >
                      {subscription.vendor_name}
                    </Link>
                  ) : (
                    "Not linked"
                  )
                }
              />
              <Row
                label="Contract"
                value={
                  subscription.vendor_contract
                    ? subscription.vendor_contract_title ||
                      subscription.vendor_contract_number
                    : "Not linked"
                }
              />
              <Row
                label="Budget category"
                value={subscription.budget_category_name || "Not linked"}
              />
              <Row
                label="Renews on card"
                value={
                  subscription.payment_card_display ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      {subscription.payment_card_display}
                    </span>
                  ) : (
                    "Not known yet"
                  )
                }
              />
              <Row
                label="Related licence"
                value={
                  subscription.linked_license ? (
                    <Link
                      href={`/licenses/${subscription.linked_license}`}
                      className="text-primary hover:underline"
                    >
                      {subscription.linked_license_name}
                    </Link>
                  ) : (
                    "Not linked"
                  )
                }
              />
              {subscription.vault_credential ? (
                <div className="col-span-2">
                  <Row
                    label="Vault credential"
                    value={
                      <Link
                        href="/vault"
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {subscription.vault_credential_title}
                      </Link>
                    }
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <CalendarClock className="h-4 w-4" /> Reminders
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-4">
              <Row
                label="Renewal reminder"
                value={
                  subscription.renewal_reminder_enabled
                    ? `${subscription.renewal_reminder_days} days before`
                    : "Off"
                }
              />
              <Row
                label="Cancellation reminder"
                value={
                  subscription.cancellation_reminder_enabled
                    ? `${subscription.cancellation_reminder_days} days before`
                    : "Off"
                }
              />
              <div className="col-span-2">
                <Row
                  label="Cancellation deadline"
                  value={
                    subscription.cancellation_deadline
                      ? formatDate(subscription.cancellation_deadline)
                      : "Not set"
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <Users className="h-4 w-4" /> Seats
                <span className="ml-1 normal-case tracking-normal text-foreground">
                  {subscription.seats_used}
                  {subscription.seats_total === null
                    ? " assigned (unlimited)"
                    : ` of ${subscription.seats_total} used`}
                </span>
              </CardTitle>
              {canEdit && (
                <AssignSeatDialog
                  subscriptionId={subscriptionId}
                  disabled={seatsFull}
                  disabledReason="Every seat is taken. Revoke one or raise the seat count first."
                  onSuccess={() => void fetchSubscription()}
                />
              )}
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nobody has been given a seat yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Status</TableHead>
                      {canEdit && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell>
                          <div className="font-medium">{assignment.user_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {assignment.user_email}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {assignment.user_department || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(assignment.assigned_date)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              assignment.is_active ? STATUS_STYLES.ACTIVE : STATUS_STYLES.CANCELLED
                            }
                          >
                            {assignment.is_active ? "Active" : "Revoked"}
                          </Badge>
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            {assignment.is_active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() =>
                                  void revokeSeat(assignment.user, assignment.user_name)
                                }
                              >
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> Renewal history
              </CardTitle>
            </CardHeader>
            <CardContent>
              {renewals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No renewals recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Renewed on</TableHead>
                      <TableHead>Moved expiry</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renewals.map((renewal) => (
                      <TableRow key={renewal.id}>
                        <TableCell className="text-sm">
                          {formatDate(renewal.renewed_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {renewal.previous_expiry
                            ? `${formatDate(renewal.previous_expiry)} → ${formatDate(renewal.new_expiry)}`
                            : formatDate(renewal.new_expiry)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatMoney(Number(renewal.cost), subscription.currency)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {renewal.renewed_by_name || "Automatic"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <CreditCard className="h-4 w-4" /> Card charges
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No card charges matched yet. Connect Brex under Settings →
                  Integrations to pull them in automatically.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Card</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-sm">{formatDate(payment.posted_at)}</TableCell>
                        <TableCell className="text-sm">
                          {payment.merchant || "—"}
                          {payment.match_source === "AUTO" && (
                            <span className="ml-2 text-xs text-muted-foreground">matched automatically</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {payment.card || "—"}
                          {payment.card_label && (
                            <span className="block text-xs text-muted-foreground">{payment.card_label}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatMoney(Number(payment.amount), payment.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                <CircleDollarSign className="h-4 w-4" /> Linked expenses
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expenses.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No expenses have been linked to this subscription.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Expense</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell className="text-sm font-medium">{expense.title}</TableCell>
                        <TableCell className="text-sm">
                          {formatDate(expense.expense_date)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatMoney(Number(expense.amount), subscription.currency)}
                        </TableCell>
                        <TableCell className="text-sm">{expense.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {subscription.purpose || subscription.notes ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" /> Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {subscription.purpose && (
                  <div>
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Why it&apos;s used
                    </span>
                    <p className="whitespace-pre-wrap">{subscription.purpose}</p>
                  </div>
                )}
                {subscription.notes && (
                  <div>
                    <span className="mb-1 block text-xs text-muted-foreground">Notes</span>
                    <p className="whitespace-pre-wrap">{subscription.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <SubscriptionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        subscription={subscription}
        users={options.users}
        departments={options.departments}
        vendors={options.vendors}
        contracts={options.contracts}
        budgetCategories={options.budgetCategories}
        vaultCredentials={options.vaultCredentials}
        licenses={options.licenses}
        currencies={options.currencies}
        onSubmit={saveSubscription}
      />

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renew {subscription.name}</DialogTitle>
            <DialogDescription>
              Records the renewal and moves the expiry date forward.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="renew-expiry">New expiry date</Label>
              <Input
                id="renew-expiry"
                type="date"
                value={renewForm.new_expiry}
                onChange={(event) =>
                  setRenewForm({ ...renewForm, new_expiry: event.target.value })
                }
              />
              {suggestedExpiry && renewForm.new_expiry !== suggestedExpiry && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setRenewForm({ ...renewForm, new_expiry: suggestedExpiry })
                  }
                >
                  Use suggestion ({formatDate(suggestedExpiry)})
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="renew-cost">Cost paid</Label>
                <Input
                  id="renew-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  value={renewForm.cost}
                  onChange={(event) =>
                    setRenewForm({ ...renewForm, cost: event.target.value })
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="renew-seats">Seats added</Label>
                <Input
                  id="renew-seats"
                  type="number"
                  min={0}
                  step={1}
                  value={renewForm.seats_added}
                  onChange={(event) =>
                    setRenewForm({ ...renewForm, seats_added: event.target.value })
                  }
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="renew-notes">Notes</Label>
              <Textarea
                id="renew-notes"
                rows={3}
                value={renewForm.notes}
                onChange={(event) =>
                  setRenewForm({ ...renewForm, notes: event.target.value })
                }
                placeholder="Anything worth recording about this renewal…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitRenew()} disabled={renewing}>
              {renewing ? "Renewing…" : "Renew"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

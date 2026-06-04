"use client";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  History, 
  MessageSquarePlus, 
  MoreHorizontal,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";

export interface AssetNote {
  id: number;
  asset: number;
  created_by: number;
  created_by_name: string;
  note: string;
  created_at: string;
}

export interface Asset {
  id: number;
  asset_tag: string;
  name: string;
}

const formSchema = z.object({
  asset: z.string().min(1, "Select an asset to bind this note to."),
  note: z.string().min(5, "Note must be at least 5 characters."),
});

export default function AssetNotesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [notes, setNotes] = useState<AssetNote[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      asset: "",
      note: "",
    },
  });

  const fetchDependencies = async () => {
    try {
      const res = await api.get("/assets/");
      setAssets(res.data);
    } catch {
      toast.error("Failed to load asset index.");
    }
  };

  const fetchNotes = async () => {
    try {
      setIsLoading(true);
      const res = await api.get("/asset-notes/");
      setNotes(res.data);
    } catch (err) {
      toast.error("Failed to load audit timelines.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDependencies();
    fetchNotes();
  }, []);

  const openAddDialog = () => {
    form.reset({ asset: "", note: "" });
    setIsDialogOpen(true);
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      await api.post("/asset-notes/", {
        asset: parseInt(values.asset),
        note: values.note
      });
      toast.success("Audit note logged securely.");
      setIsDialogOpen(false);
      fetchNotes();
    } catch (err) {
      toast.error("Failed to append note.");
    }
  };

  const deleteNote = async (n: AssetNote) => {
    try {
      await api.delete(`/asset-notes/${n.id}/`);
      toast.success("Note stripped from ledger.");
      fetchNotes();
    } catch (err) {
      toast.error("Failed to strip note.");
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto h-full p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Ledger</h1>
          <p className="text-neutral-500">Immutable chronological timeline of hardware repairs and notes.</p>
        </div>
        <Button onClick={openAddDialog}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> Append Record
        </Button>
      </div>

      <Card className="flex-1 bg-white dark:bg-neutral-900 overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead className="w-[150px]">Asset Node</TableHead>
              <TableHead className="w-[150px]">Author</TableHead>
              <TableHead>Note</TableHead>
              {isAdmin && <TableHead className="text-right w-[80px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 5 : 4} className="text-center py-10 text-neutral-500">
                    Pulling ledger feeds...
                 </TableCell>
              </TableRow>
            ) : notes.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 5 : 4} className="text-center py-10 text-neutral-500">
                    No chronological records deployed yet.
                 </TableCell>
              </TableRow>
            ) : (
              notes.map((n) => {
                const targetAsset = assets.find(a => a.id === n.asset);
                return (
                <TableRow key={n.id}>
                  <TableCell className="text-xs text-neutral-500 tabular-nums">
                    <div className="flex items-center gap-1.5">
                       <History className="w-3 h-3" />
                       {format(new Date(n.created_at), "MMM d, yyyy HH:mm")}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {targetAsset ? targetAsset.asset_tag : "ASSET_N/A"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {n.created_by_name}
                  </TableCell>
                  <TableCell className="text-sm">
                    {n.note}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                            onSelect={() => deleteNote(n)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Strip Record
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Append Chronological Audit</DialogTitle>
            <DialogDescription>
              Write an immutable note bound strictly to an asset tag.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="asset"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Asset Node</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select hardware node..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {assets.map(a => (
                          <SelectItem key={a.id} value={a.id.toString()}>
                            [{a.asset_tag}] {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Audit Entry</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Device dropped, logic board replaced..." className="min-h-[100px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Append Note</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

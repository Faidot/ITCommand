"use client";

/**
 * Edit / Delete for an estate row.
 *
 * One component for all four screens, because the delete confirmation is the
 * part worth getting right once: it names the thing being deleted, says what
 * else it affects, and surfaces the server's refusal verbatim when the row is
 * protected. A generic "Are you sure?" teaches people to click through.
 */

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { errorMessage } from "./estate-types";

export function RowActions({
  onEdit,
  canEdit,
  canDelete,
  deleteUrl,
  deleteTitle,
  deleteBody,
  onDeleted,
}: {
  onEdit?: () => void;
  canEdit: boolean;
  canDelete: boolean;
  /** API path, e.g. `/estate/services/12/`. */
  deleteUrl: string;
  /** What is being deleted, quoted back to the user. */
  deleteTitle: string;
  /** What else this affects. One sentence, concrete. */
  deleteBody: string;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canEdit && !canDelete) return null;

  const remove = async () => {
    setBusy(true);
    try {
      const response = await api.delete<{ detail?: string; orphaned_count?: number }>(
        deleteUrl,
      );
      // A property delete returns 200 with a count of what it just orphaned.
      // That number moves a KPI, so it is said out loud rather than swallowed.
      const detail = response.data?.detail;
      toast.success(detail || `${deleteTitle} deleted.`);
      setConfirmOpen(false);
      onDeleted();
    } catch (reason) {
      const status = (reason as { response?: { status?: number } })?.response?.status;
      // 409 means the server refused because something still depends on it.
      // Its message names what and how many; ours would only be vaguer.
      toast.error(
        errorMessage(reason, "Could not delete that."),
        status === 409 ? { duration: 8000 } : undefined,
      );
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && onEdit && (
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              className="text-red-600 focus:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={(next) => !busy && setConfirmOpen(next)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete {deleteTitle}?</DialogTitle>
            <DialogDescription>{deleteBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={busy}
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RowActions;

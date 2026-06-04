"use client";

import * as React from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface ComboboxOption {
  id: number | string;
  label: string;
  hint?: string;
}

export interface InlineComboboxProps {
  value: string | number | null | undefined;
  onChange: (id: string | number | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /**
   * Called when the user submits a new entry name from the "+ Add new" flow.
   * Should create the entity, then return its id and label so the combobox
   * can pre-select it. Throw to signal failure.
   */
  onCreate?: (name: string) => Promise<ComboboxOption>;
  createLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Selectable list of options with a built-in "+ Add new" flow.
 *
 * Pattern: click button → dialog with searchable command list. If the search
 * yields no matches AND onCreate is provided, a small inline create form is
 * shown to add the entry without leaving the dialog.
 */
export function InlineCombobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search or type to add…",
  emptyText = "No matches.",
  onCreate,
  createLabel = "Add",
  disabled,
  className,
}: InlineComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creatingName, setCreatingName] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const selected = options.find((o) => String(o.id) === String(value));

  const handleSelect = (id: string | number) => {
    onChange(id);
    setOpen(false);
    setSearch("");
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
    setSearch("");
  };

  const handleStartCreate = () => {
    setCreatingName(search.trim());
    setCreateOpen(true);
  };

  const handleConfirmCreate = async () => {
    if (!onCreate || !creatingName.trim()) return;
    setCreating(true);
    try {
      const created = await onCreate(creatingName.trim());
      onChange(created.id);
      setCreateOpen(false);
      setOpen(false);
      setSearch("");
      setCreatingName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`w-full justify-between font-normal ${className ?? ""}`}
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 overflow-hidden sm:max-w-md">
          <DialogTitle className="sr-only">{placeholder}</DialogTitle>
          <Command shouldFilter={true}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-80">
              <CommandEmpty>
                <div className="px-3 py-4 text-sm text-muted-foreground space-y-3">
                  <div>{emptyText}</div>
                  {onCreate && search.trim() && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={handleStartCreate}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {createLabel} &quot;{search.trim()}&quot;
                    </Button>
                  )}
                </div>
              </CommandEmpty>
              {value != null && (
                <CommandGroup>
                  <CommandItem onSelect={handleClear} value="__clear__">
                    <span className="text-muted-foreground">Clear selection</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.label} ${opt.hint ?? ""}`}
                    onSelect={() => handleSelect(opt.id)}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        String(opt.id) === String(value) ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <span className="font-medium">{opt.label}</span>
                    {opt.hint && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {opt.hint}
                      </span>
                    )}
                  </CommandItem>
                ))}
                {onCreate && search.trim() && options.some((o) => o.label.toLowerCase() !== search.trim().toLowerCase()) && (
                  <CommandItem value="__add_new__" onSelect={handleStartCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    <span className="font-medium">
                      {createLabel} &quot;{search.trim()}&quot;
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={creatingName}
              onChange={(e) => setCreatingName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleConfirmCreate} disabled={creating || !creatingName.trim()}>
              {creating ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

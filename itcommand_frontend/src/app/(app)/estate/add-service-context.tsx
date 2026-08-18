"use client";

/**
 * One Add Service dialog for the whole estate.
 *
 * The header button, the ⌘K palette, an empty state and a stack gap's "attach
 * service" action all open the same wizard. Mounting one instance at the layout
 * and opening it through context avoids four copies that drift apart — and the
 * gap action needs to pre-seed the property and type, which a per-screen copy
 * would each have to reimplement.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { AddServiceDialog, ServiceSeed } from "./add-service-dialog";

interface AddServiceContextValue {
  /** Open the wizard, optionally pre-seeded from a gap or a property page. */
  open: (seed?: ServiceSeed) => void;
  /** Bump to make screens refetch after a service is created or edited. */
  version: number;
  /** Ask every screen to refetch — used by anything that writes outside the
   *  wizard, such as a bulk import. */
  bump: () => void;
}

const AddServiceContext = createContext<AddServiceContextValue>({
  open: () => {},
  version: 0,
  bump: () => {},
});

export function useAddServiceDialog() {
  return useContext(AddServiceContext);
}

export function AddServiceProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [seed, setSeed] = useState<ServiceSeed | undefined>(undefined);
  const [version, setVersion] = useState(0);

  const open = useCallback((next?: ServiceSeed) => {
    setSeed(next);
    setIsOpen(true);
  }, []);

  const bump = useCallback(() => setVersion((current) => current + 1), []);

  const value = useMemo(() => ({ open, version, bump }), [open, version, bump]);

  return (
    <AddServiceContext.Provider value={value}>
      {children}
      <AddServiceDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        seed={seed}
        onSaved={() => {
          setIsOpen(false);
          setSeed(undefined);
          setVersion((current) => current + 1);
        }}
      />
    </AddServiceContext.Provider>
  );
}

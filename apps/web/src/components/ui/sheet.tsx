'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './icon-button';

/**
 * Bottom sheet on phones, centred dialog on wider screens. Built on native <dialog>,
 * so focus trapping, Escape to close and the backdrop come from the browser.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      aria-labelledby="sheet-title"
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-(--radius-sheet) bg-surface p-0 text-ink sm:m-auto sm:max-w-lg sm:rounded-(--radius-sheet)"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h2 id="sheet-title" className="font-display text-xl font-bold">
            {title}
          </h2>
          <IconButton label="Close" icon={<X size={20} aria-hidden />} onClick={onClose} />
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}

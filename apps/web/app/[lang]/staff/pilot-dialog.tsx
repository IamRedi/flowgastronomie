"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { PilotIcon } from "./pilot-icon";

/** Native modal provides focus containment, Escape and inert background content. */
export function PilotDialog({
  children,
  title,
  closeLabel,
  onClose,
  className = "",
  dismissOnBackdrop = false,
  returnFocusRef,
}: {
  children: ReactNode;
  title: string;
  closeLabel: string;
  onClose: () => void;
  className?: string;
  dismissOnBackdrop?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pointerStartedOutside = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      const target = returnFocusRef?.current ?? previousFocus;
      if (target instanceof HTMLElement && target.isConnected)
        target.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);
  const outside = (element: HTMLDialogElement, x: number, y: number) => {
    const rect = element.getBoundingClientRect();
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
  };
  return (
    <dialog
      ref={dialog}
      className={`pilot-dialog ${className}`}
      aria-label={title}
      aria-modal="true"
      onPointerDown={(event) => {
        pointerStartedOutside.current =
          event.target === event.currentTarget &&
          outside(event.currentTarget, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (
          dismissOnBackdrop &&
          pointerStartedOutside.current &&
          event.target === event.currentTarget &&
          outside(event.currentTarget, event.clientX, event.clientY)
        )
          onClose();
        pointerStartedOutside.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // A customer picker can open above the basket dialog. Only the top
        // dialog owns keyboard containment; do not run the parent's trap.
        event.stopPropagation();
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="pilot-dialog-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="pilot-icon-button"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <PilotIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

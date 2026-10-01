"use client";

import { cn } from "@/lib/cn";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

/** What {@link usePopover} hands its trigger and {@link PopoverPanel}. */
export interface PopoverState {
  /** Whether the panel is showing. */
  open: boolean;
  /** Show the panel. */
  show: () => void;
  /** Hide the panel and hand focus back to the trigger. */
  close: () => void;
  /** Hide the panel and leave focus alone, for a pick that navigates away. */
  hide: () => void;
  /** Hide it when showing, show it when hidden. */
  toggle: () => void;
  /** The panel's id, for the trigger's `aria-controls`. */
  panelId: string;
  /** Close on Escape; put it on the trigger (the panel has it already). */
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Open state for a trigger and the panel it drops: Escape closes, and closing
 * hands focus back to the trigger.
 *
 * A page navigated away from is held hidden rather than unmounted, so an open
 * panel would still be open on the way back. Effects are torn down when the
 * route hides, so closing from a cleanup catches it; that cleanup uses the
 * setter rather than `close`, since focusing a hidden button would pull focus
 * off the page being opened.
 *
 * The caller owns the trigger's ref and passes it in: a ref inside the returned
 * object would make every read of it a ref read during render.
 * @param buttonRef - The trigger button, which gets focus back on close.
 * @returns The popover's state and handlers.
 */
export function usePopover(buttonRef: RefObject<HTMLButtonElement | null>): PopoverState {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    return () => setOpen(false);
  }, [open]);

  /** Hide the panel and hand focus back to the trigger. */
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  /** Show the panel. */
  const show = (): void => {
    setOpen(true);
  };
  /** Hide the panel, leaving focus where it is. */
  const hide = (): void => {
    setOpen(false);
  };
  /** Flip the panel. */
  const toggle = (): void => {
    if (open) close();
    else setOpen(true);
  };
  /**
   * Close on Escape.
   * @param e - The key event.
   */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  return { open, show, close, hide, toggle, panelId, onKeyDown };
}

/** Props for {@link PopoverPanel}. */
export interface PopoverPanelProps {
  /** The state from {@link usePopover}. */
  popover: PopoverState;
  /** `dialog` for a panel that takes a choice and closes; `group` for one to read. */
  role: "dialog" | "group";
  /** The panel's accessible name. */
  label: string;
  /** Which edge of the trigger the panel lines up with from `sm` up. */
  align?: "start" | "end";
  /** Width and padding classes, such as `sm:w-64 p-3`. */
  className?: string;
  children: ReactNode;
}

/**
 * The panel a trigger drops, over a backdrop that closes it. From `sm` up it
 * anchors under the trigger's nearest positioned ancestor; a phone gets a sheet
 * across the bottom of the viewport instead, since an anchored panel off a
 * right-hand trigger would run off a 390px screen. Focus moves into the panel
 * when it opens, so the next Tab lands on its first control.
 * @param props - Component props.
 * @param props.popover - The popover's state.
 * @param props.role - Dialog or group.
 * @param props.label - Accessible name.
 * @param props.align - Edge to line up with.
 * @param props.className - Width and padding.
 * @param props.children - The panel's content.
 * @returns The backdrop and panel, or nothing while closed.
 */
export function PopoverPanel({
  popover,
  role,
  label,
  align = "start",
  className,
  children,
}: PopoverPanelProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { open } = popover;
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <>
      {/* `pointerdown`, not `click`: a tap on a plain div does not reliably
          raise a click on iOS Safari. Sits under the panel and over the sticky
          header, which is `z-40`. */}
      <div className="fixed inset-0 z-40" onPointerDown={popover.close} aria-hidden />
      <div
        ref={panelRef}
        id={popover.panelId}
        role={role}
        aria-modal={role === "dialog" ? true : undefined}
        aria-label={label}
        tabIndex={-1}
        onKeyDown={popover.onKeyDown}
        className={cn(
          "fixed inset-x-3 bottom-3 z-50 border border-at-border bg-at-surface text-left text-at-ink normal-case shadow-lg outline-none sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:mt-1",
          align === "end" ? "sm:right-0" : "sm:left-0",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

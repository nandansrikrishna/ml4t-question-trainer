"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function StudyDialog({ children, labelId, onClose }: {
  children: ReactNode;
  labelId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    const viewport = window.visualViewport;
    const fitViewport = () => {
      if (!element || !viewport) return;
      element.style.height = `${viewport.height}px`;
      element.style.top = `${viewport.offsetTop}px`;
    };
    element?.showModal();
    fitViewport();
    viewport?.addEventListener("resize", fitViewport);
    viewport?.addEventListener("scroll", fitViewport);
    document.body.style.overflow = "hidden";
    return () => {
      viewport?.removeEventListener("resize", fitViewport);
      viewport?.removeEventListener("scroll", fitViewport);
      element?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="modal-backdrop" aria-labelledby={labelId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {children}
    </dialog>
  );
}

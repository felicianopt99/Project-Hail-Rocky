import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const TYPE_STYLES: Record<ToastType, { border: string; text: string; dot: string }> = {
  success: {
    border: "border-cyan-500/60",
    text: "text-cyan-300",
    dot: "bg-cyan-400",
  },
  error: {
    border: "border-red-500/60",
    text: "text-red-400",
    dot: "bg-red-500",
  },
  warning: {
    border: "border-yellow-500/60",
    text: "text-yellow-300",
    dot: "bg-yellow-400",
  },
  info: {
    border: "border-white/20",
    text: "text-white/70",
    dot: "bg-white/50",
  },
};

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const styles = TYPE_STYLES[toast.type];
  const duration = toast.duration ?? 3000;

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onRemove]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-sm border bg-black/90 backdrop-blur-md font-mono ${styles.border}`}
      style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.7)" }}
    >
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${styles.dot}`} />
      <span className={`text-[11px] uppercase tracking-widest leading-snug ${styles.text}`}>
        {toast.message}
      </span>
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-2 text-white/20 hover:text-white/60 transition-colors text-[10px] leading-none flex-shrink-0"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div
      className="fixed bottom-12 left-6 z-[200] flex flex-col gap-2 items-start"
      aria-live="polite"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false} mode="sync">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <ToastItem toast={t} onRemove={onRemove} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

let _toastCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", duration?: number) => {
      const id = `toast-${++_toastCounter}-${Date.now()}`;
      setToasts((prev) => [...prev, { id, message, type, duration }]);
    },
    []
  );

  return { toasts, addToast, removeToast };
}

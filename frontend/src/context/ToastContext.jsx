import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((message, opts = {}) => {
    const id = ++toastId;
    const item = {
      id,
      message,
      type: opts.type || 'success',
      duration: opts.duration ?? 4000,
    };
    setToasts((t) => [...t.slice(-4), item]);
    if (item.duration > 0) {
      setTimeout(() => dismiss(id), item.duration);
    }
    return id;
  }, [dismiss]);

  const success = useCallback((msg, opts) => toast(msg, { ...opts, type: 'success' }), [toast]);
  const error = useCallback((msg, opts) => toast(msg, { ...opts, type: 'error', duration: 6000 }), [toast]);
  const info = useCallback((msg, opts) => toast(msg, { ...opts, type: 'info' }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, dismiss, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast requires ToastProvider');
  return ctx;
}

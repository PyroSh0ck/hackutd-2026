"use client";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "radix-ui";
import s from "@visual/advanced.module.css";
export type ToastMessage = {
  title: string;
  description?: string;
  tone?: "success" | "error" | "info";
};
type Entry = ToastMessage & { id: string };
const Context = createContext<((message: ToastMessage) => void) | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Entry[]>([]);
  const notify = useCallback(
    (message: ToastMessage) =>
      setMessages((current) =>
        [...current, { ...message, id: crypto.randomUUID() }].slice(-5),
      ),
    [],
  );
  return (
    <Context.Provider value={notify}>
      <Toast.Provider duration={5000} swipeDirection="right">
        {children}
        {messages.map((message) => (
          <Toast.Root
            key={message.id}
            className={s.toast}
            data-tone={message.tone ?? "info"}
            onOpenChange={(open) => {
              if (!open)
                setMessages((current) =>
                  current.filter((item) => item.id !== message.id),
                );
            }}
          >
            <Toast.Title className={s.strong}>{message.title}</Toast.Title>
            {message.description && (
              <Toast.Description>{message.description}</Toast.Description>
            )}
            <Toast.Close className={s.button} aria-label="Dismiss notification">
              Dismiss
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className={s.toastViewport} />
      </Toast.Provider>
    </Context.Provider>
  );
}
export function useToast() {
  const notify = useContext(Context);
  if (!notify) throw new Error("useToast must be used inside ToastProvider");
  return notify;
}

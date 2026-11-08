"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import s from "@visual/advanced.module.css";
export type UploadContext = {
  signal: AbortSignal;
  onProgress: (percent: number) => void;
};
export type FileUploadProps = {
  label: string;
  accept?: string;
  maxFiles?: number;
  maxBytes?: number;
  disabled?: boolean;
  onUpload: (file: File, context: UploadContext) => Promise<void>;
};
type Entry = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "complete" | "error" | "canceled";
  progress?: number;
  error?: string;
};
export function acceptsFile(file: File, accept?: string) {
  if (!accept?.trim()) return true;
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
    if (rule.endsWith("/*"))
      return file.type.toLowerCase().startsWith(rule.slice(0, -1));
    return file.type.toLowerCase() === rule;
  });
}
function Preview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/") || !image.current) return;
    const element = image.current;
    const objectUrl = URL.createObjectURL(file);
    element.src = objectUrl;
    return () => {
      element.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);
  return file.type.startsWith("image/") ? (
    // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, next/image cannot optimize it
    <img
      ref={image}
      className={s.filePreview}
      alt={`Preview of ${file.name}`}
    />
  ) : null;
}
export function FileUpload({
  label,
  accept,
  maxFiles = 5,
  maxBytes = 10 * 1024 * 1024,
  disabled = false,
  onUpload,
}: FileUploadProps) {
  const id = useId();
  const [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState("");
  const active = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const countLimit = Number.isFinite(maxFiles)
    ? Math.max(1, Math.floor(maxFiles))
    : 5;
  const sizeLimit =
    Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 10 * 1024 * 1024;
  useEffect(() => {
    mounted.current = true;
    const controllers = active.current;
    return () => {
      mounted.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);
  function choose(files: FileList | null) {
    if (disabled || !files) return;
    const picked = Array.from(files);
    if (picked.some((file) => !acceptsFile(file, accept))) {
      setError("One or more files have an unsupported type.");
      return;
    }
    if (picked.some((file) => file.size > sizeLimit)) {
      setError(`Each file must be at most ${sizeLimit} bytes.`);
      return;
    }
    if (entries.length + picked.length > countLimit) {
      setError(
        `Choose at most ${countLimit} files. Remove existing files to add more.`,
      );
      return;
    }
    setError("");
    setEntries((current) => [
      ...current,
      ...picked.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "queued" as const,
      })),
    ]);
  }
  function patch(id: string, update: Partial<Entry>) {
    if (mounted.current)
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, ...update } : entry,
        ),
      );
  }
  async function upload(entry: Entry) {
    if (disabled || active.current.has(entry.id)) return;
    const controller = new AbortController();
    active.current.set(entry.id, controller);
    patch(entry.id, {
      status: "uploading",
      progress: undefined,
      error: undefined,
    });
    try {
      await onUpload(entry.file, {
        signal: controller.signal,
        onProgress: (percent) => {
          if (!controller.signal.aborted && Number.isFinite(percent))
            patch(entry.id, { progress: Math.min(100, Math.max(0, percent)) });
        },
      });
      if (!controller.signal.aborted)
        patch(entry.id, { status: "complete", progress: 100 });
    } catch (cause) {
      if (!controller.signal.aborted)
        patch(entry.id, {
          status: "error",
          error: cause instanceof Error ? cause.message : "Upload failed.",
        });
    } finally {
      if (active.current.get(entry.id) === controller)
        active.current.delete(entry.id);
    }
  }
  function cancel(entry: Entry) {
    active.current.get(entry.id)?.abort();
    active.current.delete(entry.id);
    patch(entry.id, { status: "canceled", progress: undefined });
  }
  return (
    <section className={s.stack} aria-label={label}>
      <div
        className={s.dropzone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          choose(event.dataTransfer.files);
        }}
      >
        <label htmlFor={id}>{label}</label>
        <p>Drop files here or choose files below.</p>
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={countLimit > 1}
          disabled={disabled}
          onChange={(event) => {
            choose(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <ul className={s.stack}>
        {entries.map((entry) => (
          <li key={entry.id} className={s.panel}>
            <Preview file={entry.file} />
            <strong>{entry.file.name}</strong>
            <span role="status">{entry.status}</span>
            {entry.status === "uploading" && (
              <Progress
                label={`Uploading ${entry.file.name}`}
                value={entry.progress}
              />
            )}{" "}
            {entry.error && <p role="alert">{entry.error}</p>}
            <div className={s.row}>
              {entry.status === "uploading" ? (
                <Button
                  text="Cancel upload"
                  variant="secondary"
                  onClick={() => cancel(entry)}
                />
              ) : (
                entry.status !== "complete" && (
                  <Button
                    text={entry.status === "queued" ? "Upload" : "Retry upload"}
                    disabled={disabled}
                    onClick={() => void upload(entry)}
                  />
                )
              )}
              <Button
                text="Remove"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  cancel(entry);
                  setEntries((current) =>
                    current.filter((item) => item.id !== entry.id),
                  );
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

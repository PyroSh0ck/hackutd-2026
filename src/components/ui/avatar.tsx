"use client";
import { Avatar as Primitive } from "radix-ui";
import s from "@visual/ui.module.css";
export type AvatarProps = { name: string; src?: string; decorative?: boolean };
export function Avatar({ name, src, decorative = false }: AvatarProps) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <Primitive.Root className={s.avatar} aria-hidden={decorative || undefined}>
      <Primitive.Image
        className={s.avatarImage}
        src={src}
        alt={decorative ? "" : name}
      />
      <Primitive.Fallback
        className={s.avatarFallback}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : name}
      >
        {initials}
      </Primitive.Fallback>
    </Primitive.Root>
  );
}

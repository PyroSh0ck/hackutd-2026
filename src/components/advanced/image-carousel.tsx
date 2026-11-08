"use client";
import { useState, useRef } from "react";
import { Button } from "../ui/button";
import s from "@visual/advanced.module.css";
export type GalleryItem = {
  id: string;
  src: string;
  alt: string;
  caption?: string;
};
export type ImageCarouselProps = {
  items: readonly GalleryItem[];
  label: string;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
};
function Slide({ item }: { item: GalleryItem }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return (
    <figure className={s.slide}>
      <div className={s.imageFrame}>
        {state === "loading" && <span role="status">Loading image…</span>}
        {state === "error" ? (
          <div role="alert">
            Image unavailable.{" "}
            <button
              type="button"
              className={s.button}
              onClick={() => {
                setState("loading");
                setAttempt((x) => x + 1);
              }}
            >
              Retry image
            </button>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary caller URLs; retry needs a plain img
          <img
            key={attempt}
            src={item.src}
            alt={item.alt}
            onLoad={() => setState("ready")}
            onError={() => setState("error")}
          />
        )}
      </div>
      {item.caption && <figcaption>{item.caption}</figcaption>}
    </figure>
  );
}
export function ImageCarousel({
  items,
  label,
  initialIndex = 0,
  onIndexChange,
}: ImageCarouselProps) {
  const [index, setIndex] = useState(
    Number.isFinite(initialIndex) ? Math.max(0, Math.floor(initialIndex)) : 0,
  );
  const start = useRef<{ x: number; y: number } | null>(null);
  const current = Math.min(index, Math.max(0, items.length - 1));
  function go(next: number) {
    const bounded = Math.min(items.length - 1, Math.max(0, next));
    if (bounded !== current) {
      setIndex(bounded);
      onIndexChange?.(bounded);
    }
  }
  if (!items.length) return <p>No images to display.</p>;
  return (
    <section
      className={s.stack}
      aria-label={label}
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(current + 1);
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(current - 1);
        }
      }}
      onTouchStart={(event) => {
        const t = event.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(event) => {
        if (!start.current) return;
        const t = event.changedTouches[0],
          dx = t.clientX - start.current.x,
          dy = t.clientY - start.current.y;
        start.current = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
          go(current + (dx < 0 ? 1 : -1));
      }}
    >
      <Slide
        key={`${items[current].id}:${items[current].src}`}
        item={items[current]}
      />
      <div className={s.row}>
        <Button
          text="Previous image"
          variant="secondary"
          disabled={current === 0}
          onClick={() => go(current - 1)}
        />
        <span aria-live="polite">
          {current + 1} / {items.length}
        </span>
        <Button
          text="Next image"
          variant="secondary"
          disabled={current === items.length - 1}
          onClick={() => go(current + 1)}
        />
      </div>
      <div className={s.row}>
        {items.map((item, i) => (
          <button
            type="button"
            key={item.id}
            className={s.dot}
            aria-label={`Show image ${i + 1}`}
            aria-current={current === i ? "true" : undefined}
            onClick={() => go(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </section>
  );
}

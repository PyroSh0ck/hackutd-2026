import Image from "next/image";
import { HatGlasses, Search } from "lucide-react";
import s from "./scamper.module.css";

/**
 * The detective guide. It is never the impersonator's avatar and its expression never hints at whether a
 * scenario is legitimate.
 *
 * Asset slot: drop a transparent PNG at `public/images/scamper-detective.png` and set MASCOT_SRC to
 * "/images/scamper-detective.png". Until then a neutral icon badge is shown. Size is reserved either way.
 */
export const MASCOT_SRC: string | null = null;

export function Mascot({ size = 132, description }: { size?: number; description?: string }) {
  const decorative = !description;
  return (
    <div className={s.mascot} style={{ width: size, height: size }} role={decorative ? undefined : "img"} aria-label={description} aria-hidden={decorative || undefined}>
      {MASCOT_SRC ? (
        <Image className={s.mascotImage} src={MASCOT_SRC} alt="" width={size} height={size} />
      ) : (
        <span className={s.mascotFallback} style={{ width: size, height: size }}>
          <HatGlasses className={s.mascotHat} size={size * 0.46} strokeWidth={1.6} aria-hidden />
          <Search className={s.mascotGlass} size={size * 0.3} strokeWidth={2.2} style={{ position: "absolute", right: "16%", bottom: "20%" }} aria-hidden />
        </span>
      )}
    </div>
  );
}

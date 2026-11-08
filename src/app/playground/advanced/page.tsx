import { notFound } from "next/navigation";
import { AdvancedGallery } from "../../../../examples/advanced-gallery";

// Development-only visual review surface. Production builds return 404.
export default function AdvancedPlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AdvancedGallery />;
}

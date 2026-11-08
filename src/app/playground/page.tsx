import { notFound } from "next/navigation";
import { ComponentGallery } from "../../../examples/component-gallery";

// Development-only visual review surface. Production builds return 404.
export default function PlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ComponentGallery />;
}

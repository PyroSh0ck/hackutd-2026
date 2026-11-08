import {
  Plus,
  Save,
  Trash2,
  Pencil,
  Search,
  Download,
  Upload,
  ArrowLeft,
  ArrowRight,
  Check,
  X,
} from "lucide-react";
const icons = {
  plus: Plus,
  save: Save,
  trash: Trash2,
  edit: Pencil,
  search: Search,
  download: Download,
  upload: Upload,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  check: Check,
  close: X,
};
export type ButtonIcon = keyof typeof icons;
export function Icon({ name }: { name: ButtonIcon }) {
  const Glyph = icons[name];
  return <Glyph size={18} aria-hidden="true" focusable="false" />;
}

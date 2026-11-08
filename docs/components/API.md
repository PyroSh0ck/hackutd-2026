# Component public APIs

Types extracted from the source. Feature code supplies business handlers and controlled state. See README.md and ADVANCED.md for integration.

## src/components/advanced/accordion.tsx

```tsx
export type AccordionItem = {
  id: string;
  title: string;
  content: ReactNode;
  disabled?: boolean;
};

export type AccordionProps = {
  items: readonly AccordionItem[];
  defaultOpenIds?: string[];
};
```

## src/components/advanced/app-navigation.tsx

```tsx
export type NavigationItem = { id: string; label: string; href: string };

export type AppNavigationProps = {
  appName: string;
  items: readonly NavigationItem[];
  activeId: string;
  account?: { name: string; actions: readonly MenuItem[] };
};
```

## src/components/advanced/chart.tsx

```tsx
export type ChartPoint = { label: string; value: number };

export type ChartProps = {
  title: string;
  data: readonly ChartPoint[];
  kind: "line" | "bar" | "donut";
  loading?: boolean;
  error?: string;
  unit?: string;
};
```

## src/components/advanced/chat-panel.tsx

```tsx
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: readonly { id: string; label: string; url: string }[];
};

export type ChatPanelProps = {
  messages: readonly ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  streaming?: boolean;
  onStop?: () => void;
  error?: string;
  onRetry?: () => void;
  disabled?: boolean;
};
```

## src/components/advanced/combobox.tsx

```tsx
export type ComboboxOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type ComboboxProps = {
  label: string;
  options: readonly ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  error?: string;
};
```

## src/components/advanced/data-table.tsx

```tsx
export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  searchValue?: (row: T) => string;
};

export type DataTableProps<T> = {
  caption: string;
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  selection?: { ids: readonly string[]; onChange: (ids: string[]) => void };
  rowActions?: (row: T) => readonly MenuItem[];
};
```

## src/components/advanced/date-picker.tsx

```tsx
export type DatePickerProps = {
  label: string;
  value: string;
  onValueChange: (date: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  error?: string;
};

export type DateRange = { start: string; end: string };

export type DateRangePickerProps = {
  label: string;
  value: DateRange;
  onValueChange: (range: DateRange) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
};
```

## src/components/advanced/drawer.tsx

```tsx
export type DrawerProps = {
  triggerText: string;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
};
```

## src/components/advanced/file-upload.tsx

```tsx
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
```

## src/components/advanced/image-carousel.tsx

```tsx
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
```

## src/components/advanced/stepper.tsx

```tsx
export type WizardStep = {
  id: string;
  title: string;
  content: ReactNode;
  validate?: () => string | undefined | Promise<string | undefined>;
};

export type StepperProps = {
  steps: readonly WizardStep[];
  onComplete: () => void | Promise<void>;
  completeText?: string;
};
```

## src/components/advanced/toast.tsx

```tsx
export type ToastMessage = {
  title: string;
  description?: string;
  tone?: "success" | "error" | "info";
};
```

## src/components/forms/form-actions.tsx

```tsx
export type FormActionsProps = {
  submitText?: string;
  loadingText?: string;
  loading?: boolean;
  disabled?: boolean;
  form?: string;
  cancelText?: string;
  onCancel?: () => void;
};
```

## src/components/forms/text-field.tsx

```tsx
export type TextFieldProps = InputProps & {
  label: string;
  hint?: string;
  error?: string;
};
```

## src/components/forms/textarea-field.tsx

```tsx
export type TextareaFieldProps = TextareaProps & {
  label: string;
  hint?: string;
  error?: string;
};
```

## src/components/layouts/kit-layouts.tsx

```tsx
export type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export type ListLayoutProps = PageHeaderProps & {
  toolbar?: ReactNode;
  children: ReactNode;
  pagination?: ReactNode;
};

export type SplitLayoutProps = { primary: ReactNode; secondary: ReactNode };

export type DetailLayoutProps = PageHeaderProps & {
  children: ReactNode;
  sidebar?: ReactNode;
};

export type DashboardLayoutProps = PageHeaderProps & {
  stats: ReactNode;
  children: ReactNode;
};
```

## src/components/patterns/empty-state.tsx

```tsx
export type EmptyStateProps = {
  title: string;
  description: string;
  action?: { text: string; onClick: () => void };
};
```

## src/components/patterns/error-state.tsx

```tsx
export type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
};
```

## src/components/patterns/search-toolbar.tsx

```tsx
export type SearchToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  loading?: boolean;
  placeholder?: string;
};
```

## src/components/patterns/stat-card.tsx

```tsx
export type StatCardProps = {
  label: string;
  value: string | number;
  description?: string;
};
```

## src/components/ui/alert-dialog.tsx

```tsx
export type AlertDialogProps = {
  triggerText: string;
  title: string;
  description: string;
  confirmText: string;
  cancelText?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading?: boolean;
  error?: string;
  destructive?: boolean;
};
```

## src/components/ui/alert.tsx

```tsx
export type AlertProps = {
  title?: string;
  message: string;
  tone?: Tone;
  onDismiss?: () => void;
};
```

## src/components/ui/avatar.tsx

```tsx
export type AvatarProps = { name: string; src?: string; decorative?: boolean };
```

## src/components/ui/badge.tsx

```tsx
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export type BadgeProps = { text: string; tone?: Tone };
```

## src/components/ui/button.tsx

```tsx
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = {
  text: string;
  loadingText?: string;
  leadingIcon?: ButtonIcon;
  trailingIcon?: ButtonIcon;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  pressed?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
  form?: string;
  name?: string;
  value?: string;
  id?: string;
  describedBy?: string;
  controls?: string;
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
};
```

## src/components/ui/card.tsx

```tsx
export type CardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
};
```

## src/components/ui/checkbox.tsx

```tsx
export type CheckboxProps = {
  label: string;
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
};
```

## src/components/ui/dialog.tsx

```tsx
export type DialogProps = {
  triggerText: string;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
};
```

## src/components/ui/dropdown-menu.tsx

```tsx
export type MenuItem = {
  id: string;
  text: string;
  icon?: ButtonIcon;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};

export type DropdownMenuProps = {
  triggerText: string;
  items: readonly MenuItem[];
  disabled?: boolean;
};
```

## src/components/ui/icon.tsx

```tsx
export type ButtonIcon = keyof typeof icons;
```

## src/components/ui/input.tsx

```tsx
export type InputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | "type"
  | "min"
  | "max"
  | "step"
  | "pattern"
  | "inputMode"
  | "id"
  | "name"
  | "value"
  | "defaultValue"
  | "onChange"
  | "onBlur"
  | "disabled"
  | "required"
  | "readOnly"
  | "placeholder"
  | "autoComplete"
  | "minLength"
  | "maxLength"
> & { invalid?: boolean; describedBy?: string; ref?: Ref<HTMLInputElement> };
```

## src/components/ui/label.tsx

```tsx
export type LabelProps = { text: string; htmlFor: string; required?: boolean };
```

## src/components/ui/pagination.tsx

```tsx
export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};
```

## src/components/ui/progress.tsx

```tsx
export type ProgressProps = { label: string; value?: number; max?: number };
```

## src/components/ui/radio-group.tsx

```tsx
export type RadioGroupProps = {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
};
```

## src/components/ui/select.tsx

```tsx
export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
};
```

## src/components/ui/separator.tsx

```tsx
export type SeparatorProps = {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
};
```

## src/components/ui/skeleton.tsx

```tsx
export type SkeletonProps = {
  kind?: "text" | "avatar" | "card";
  lines?: number;
};
```

## src/components/ui/spinner.tsx

```tsx
export type SpinnerProps = { label?: string; decorative?: boolean };
```

## src/components/ui/switch.tsx

```tsx
export type SwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  describedBy?: string;
};
```

## src/components/ui/table.tsx

```tsx
export type TableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
};

export type TableProps<T> = {
  caption: string;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  emptyText?: string;
};
```

## src/components/ui/tabs.tsx

```tsx
export type TabItem = {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  label: string;
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
};
```

## src/components/ui/textarea.tsx

```tsx
export type TextareaProps = Pick<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  | "rows"
  | "id"
  | "name"
  | "value"
  | "defaultValue"
  | "onChange"
  | "onBlur"
  | "disabled"
  | "required"
  | "readOnly"
  | "placeholder"
  | "autoComplete"
  | "minLength"
  | "maxLength"
> & { invalid?: boolean; describedBy?: string; ref?: Ref<HTMLTextAreaElement> };
```

## src/components/ui/tooltip.tsx

```tsx
export type TooltipProps = { text: string; triggerText?: string };
```

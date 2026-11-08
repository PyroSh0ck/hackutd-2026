"use client";
import { useState } from "react";
import {
  Button,
  Card,
  Badge,
  Alert,
  Spinner,
  Skeleton,
  Separator,
  Checkbox,
  Switch,
  Select,
  RadioGroup,
  Dialog,
  AlertDialog,
  Tabs,
  DropdownMenu,
  Tooltip,
  Avatar,
  Progress,
  Table,
  Pagination,
} from "@/components/ui";
import { TextField, TextareaField, FormActions } from "@/components/forms";
import {
  EmptyState,
  ErrorState,
  SearchToolbar,
  StatCard,
} from "@/components/patterns";
import {
  DashboardLayout,
  DetailLayout,
  ListLayout,
  SplitLayout,
} from "@/components/layouts/kit-layouts";
export function ComponentGallery() {
  const [checked, setChecked] = useState(false),
    [enabled, setEnabled] = useState(false);
  const [choice, setChoice] = useState("one"),
    [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState("Ready");
  const options = [
    { value: "one", label: "First option" },
    { value: "two", label: "Second option" },
    { value: "three", label: "Unavailable", disabled: true },
  ];
  return (
    <DashboardLayout
      title="Component gallery"
      description="Functional scaffolds. Change CSS and artwork without changing usages."
      stats={
        <>
          <StatCard label="Components" value="Reusable" />
          <StatCard label="Design" value="Replaceable" />
        </>
      }
    >
      <Alert message={message} />
      <Card title="Buttons">
        {(["primary", "secondary", "ghost", "danger"] as const).map(
          (variant) => (
            <Button
              key={variant}
              text={variant}
              variant={variant}
              onClick={() => setMessage(variant)}
            />
          ),
        )}
        <Button text="Saving" loading />
        <Button text="Disabled" disabled />
        <Button text="Save with icon" leadingIcon="save" trailingIcon="check" />
        <Button
          text="Favorite"
          pressed={checked}
          onClick={() => setChecked(!checked)}
        />
      </Card>
      <Card title="Form">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("Form submitted");
          }}
        >
          <TextField name="name" label="Name" required hint="Try typing here" />
          <TextareaField name="description" label="Description" />
          <TextField label="Invalid example" error="Enter a valid value" />
          <FormActions onCancel={() => setMessage("Canceled")} />
        </form>
      </Card>
      <Card title="Choices">
        <Checkbox
          label="Include archived"
          checked={checked}
          onCheckedChange={setChecked}
        />
        <Checkbox
          label="Partly selected"
          checked="indeterminate"
          onCheckedChange={setChecked}
        />
        <Switch
          label="Notifications"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <Select
          label="Category"
          options={options}
          value={choice}
          onValueChange={setChoice}
        />
        <RadioGroup
          label="Preference"
          options={options}
          value={choice}
          onValueChange={setChoice}
        />
      </Card>
      <Card title="Feedback">
        <Badge text="Ready" tone="success" />
        <Alert message="Example error" tone="danger" />
        <Separator />
        <Spinner />
        <Skeleton />
        <Avatar name="Parth Modi" />
        <Progress label="Progress" value={65} />
        <Progress label="Working" />
      </Card>
      <Card title="Overlays">
        <Dialog
          triggerText="Open dialog"
          title="Edit project"
          description="Example form in a dialog"
          open={dialog}
          onOpenChange={setDialog}
        >
          <TextField label="Project name" />
        </Dialog>
        <AlertDialog
          triggerText="Delete project"
          title="Delete project?"
          description="This demo does not delete data."
          confirmText="Delete"
          open={confirm}
          onOpenChange={setConfirm}
          onConfirm={() => {
            setMessage("Confirmed");
            setConfirm(false);
          }}
        />
        <DropdownMenu
          triggerText="Actions"
          items={[
            {
              id: "edit",
              text: "Edit",
              icon: "edit",
              onSelect: () => setMessage("Edit selected"),
            },
            {
              id: "delete",
              text: "Delete",
              destructive: true,
              onSelect: () => setConfirm(true),
            },
          ]}
        />
        <Tooltip text="Helpful information appears on focus or hover." />
      </Card>
      <Tabs
        label="Project sections"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: "overview",
            label: "Overview",
            content: <p>Overview content</p>,
          },
          {
            value: "details",
            label: "Details",
            content: <p>Details content</p>,
          },
        ]}
      />
      <ListLayout
        title="Projects"
        toolbar={
          <SearchToolbar
            query={query}
            onQueryChange={setQuery}
            onSearch={() => setMessage(`Search: ${query}`)}
          />
        }
        pagination={
          <Pagination page={page} pageCount={3} onPageChange={setPage} />
        }
      >
        <Table
          caption="Example projects"
          columns={[{ key: "name", header: "Name", cell: (row) => row.name }]}
          rows={[{ id: "1", name: "Example project" }]}
          rowKey={(row) => row.id}
        />
      </ListLayout>
      <DetailLayout title="Detail layout" sidebar={<p>Sidebar</p>}>
        <p>Main content</p>
      </DetailLayout>
      <SplitLayout
        primary={
          <EmptyState
            title="No projects"
            description="Create your first project"
            action={{
              text: "Create",
              onClick: () => setMessage("Create selected"),
            }}
          />
        }
        secondary={
          <ErrorState
            message="Example failure"
            onRetry={() => setMessage("Retry selected")}
          />
        }
      />
    </DashboardLayout>
  );
}

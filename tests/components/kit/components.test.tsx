import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Switch,
  Select,
  RadioGroup,
  Dialog,
  AlertDialog,
  Tabs,
  DropdownMenu,
  Pagination,
  Table,
  Avatar,
} from "@/components/ui";
import { TextField } from "@/components/forms";
import { ComponentGallery } from "../../../examples/component-gallery";

test("button loading prevents clicks and forwards form submission", async () => {
  const user = userEvent.setup(),
    click = vi.fn(),
    submit = vi.fn();
  const view = render(<Button text="Save" loading onClick={click} />);
  await user.click(screen.getByRole("button"));
  expect(click).not.toHaveBeenCalled();
  view.rerender(
    <>
      <form
        id="f"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      />
      <Button text="Save" type="submit" form="f" />
    </>,
  );
  await user.click(screen.getByRole("button"));
  expect(submit).toHaveBeenCalledOnce();
});
test("field links label, hint and errors; forwards change", async () => {
  const change = vi.fn();
  render(
    <TextField
      label="Name"
      hint="Your name"
      error="Required"
      onChange={change}
    />,
  );
  const input = screen.getByRole("textbox", { name: "Name" });
  expect(input).toHaveAccessibleDescription("Your name Required");
  expect(input).toHaveAttribute("aria-invalid", "true");
  await userEvent.setup().type(input, "A");
  expect(change).toHaveBeenCalled();
});
test("controlled choices emit changes", async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ];
  render(
    <>
      <Checkbox
        label="Check"
        checked="indeterminate"
        onCheckedChange={change}
      />
      <Switch label="Switch" checked={false} onCheckedChange={change} />
      <Select
        label="Select"
        options={options}
        value="a"
        onValueChange={change}
      />
      <RadioGroup
        label="Radio"
        options={options}
        value="a"
        onValueChange={change}
      />
    </>,
  );
  expect(screen.getByRole("checkbox")).toBePartiallyChecked();
  await user.click(screen.getByRole("checkbox"));
  expect(change).toHaveBeenCalledWith(true);
  await user.click(screen.getByRole("switch"));
  await user.selectOptions(screen.getByRole("combobox"), "b");
  expect(change).toHaveBeenCalledWith("b");
  await user.click(screen.getByRole("radio", { name: "B" }));
  expect(change).toHaveBeenLastCalledWith("b");
});
test("dialog opens and Escape restores focus to trigger", async () => {
  function Demo() {
    const [open, setOpen] = useState(false);
    return (
      <Dialog
        triggerText="Open"
        title="Edit"
        description="Edit details"
        open={open}
        onOpenChange={setOpen}
      >
        <TextField label="Name" />
      </Dialog>
    );
  }
  const user = userEvent.setup();
  render(<Demo />);
  const trigger = screen.getByRole("button", { name: "Open" });
  await user.click(trigger);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Edit");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
test("confirmation stays open until parent closes it", async () => {
  const confirm = vi.fn();
  render(
    <AlertDialog
      triggerText="Delete"
      title="Confirm deletion"
      description="Cannot undo"
      confirmText="Confirm"
      open
      onOpenChange={() => {}}
      onConfirm={confirm}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /^Confirm$/ }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});
test("tabs switch with keyboard", async () => {
  function Demo() {
    const [value, setValue] = useState("a");
    return (
      <Tabs
        label="Sections"
        value={value}
        onValueChange={setValue}
        items={[
          { value: "a", label: "A", content: "First panel" },
          { value: "b", label: "B", content: "Second panel" },
        ]}
      />
    );
  }
  render(<Demo />);
  screen.getByRole("tab", { name: "A" }).focus();
  await userEvent.setup().keyboard("{ArrowRight}{Enter}");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Second panel");
});
test("dropdown supports keyboard selection", async () => {
  const select = vi.fn();
  render(
    <DropdownMenu
      triggerText="Actions"
      items={[{ id: "edit", text: "Edit", onSelect: select }]}
    />,
  );
  screen.getByRole("button", { name: "Actions" }).focus();
  await userEvent.setup().keyboard("{Enter}");
  expect(
    await screen.findByRole("menuitem", { name: "Edit" }),
  ).toBeInTheDocument();
  await userEvent.setup().keyboard("{Enter}");
  expect(select).toHaveBeenCalledOnce();
});
test("pagination disables boundaries", async () => {
  const change = vi.fn();
  render(<Pagination page={1} pageCount={2} onPageChange={change} />);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
  expect(change).toHaveBeenCalledWith(2);
});
test("table renders empty state and avatar falls back", () => {
  render(
    <>
      <Table<{ id: string }>
        caption="Projects"
        rows={[]}
        columns={[{ key: "id", header: "ID", cell: (r) => r.id }]}
        rowKey={(r) => r.id}
      />
      <Avatar name="Parth Modi" />
    </>,
  );
  expect(screen.getByText("No results.")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Parth Modi" })).toHaveTextContent(
    "PM",
  );
});
test("gallery renders without application infrastructure", () => {
  render(<ComponentGallery />);
  expect(
    screen.getByRole("heading", { name: "Component gallery" }),
  ).toBeInTheDocument();
});

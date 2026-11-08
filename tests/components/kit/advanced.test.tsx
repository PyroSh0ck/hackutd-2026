import { expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  AppNavigation,
  FileUpload,
  Combobox,
  ToastProvider,
  useToast,
  Stepper,
  Drawer,
  Accordion,
  DataTable,
  Chart,
  ImageCarousel,
  DatePicker,
  DateRangePicker,
  ChatPanel,
} from "@/components/advanced";
import { AdvancedGallery } from "../../../examples/advanced-gallery";

test("combobox filters and selects with keyboard", async () => {
  const change = vi.fn();
  render(
    <Combobox
      label="Framework"
      options={[
        { value: "react", label: "React" },
        { value: "next", label: "Next" },
      ]}
      value=""
      onValueChange={change}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("combobox"), "Nex");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(change).toHaveBeenCalledWith("next");
  expect(screen.getByRole("combobox")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
test("accordion toggles with keyboard", async () => {
  render(
    <Accordion
      items={[{ id: "a", title: "Details", content: <p>Expanded content</p> }]}
    />,
  );
  await userEvent.setup().tab();
  await userEvent.setup().keyboard("{Enter}");
  expect(screen.getByText("Expanded content")).toBeVisible();
});
test("drawer returns focus after Escape", async () => {
  function Demo() {
    const [open, setOpen] = useState(false);
    return (
      <Drawer
        triggerText="Open drawer"
        title="Filters"
        description="Filter data"
        open={open}
        onOpenChange={setOpen}
      >
        <p>Content</p>
      </Drawer>
    );
  }
  render(<Demo />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open drawer" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Filters");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Open drawer" })).toHaveFocus();
});
test("toast is dismissible", async () => {
  function Demo() {
    const notify = useToast();
    return <button onClick={() => notify({ title: "Saved" })}>Notify</button>;
  }
  render(
    <ToastProvider>
      <Demo />
    </ToastProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("Notify"));
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Dismiss notification" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Saved")).not.toBeInTheDocument(),
  );
});
test("wizard blocks invalid steps and catches completion failures", async () => {
  const validate = vi
      .fn()
      .mockResolvedValueOnce("Missing name")
      .mockResolvedValue(undefined),
    complete = vi.fn().mockRejectedValue(new Error("Server unavailable"));
  render(
    <Stepper
      steps={[
        {
          id: "a",
          title: "Name",
          content: <input aria-label="Name" />,
          validate,
        },
        { id: "b", title: "Review", content: <p>Review data</p> },
      ]}
      onComplete={complete}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Missing name");
  expect(screen.getByRole("heading")).toHaveTextContent("Name");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    await screen.findByRole("heading", { name: "Review" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Finish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Server unavailable",
  );
});
test("table sorts numerically, filters, and selects a visible page", async () => {
  const change = vi.fn();
  render(
    <DataTable
      caption="Tasks"
      rows={[
        { id: "a", name: "Alpha", n: 12 },
        { id: "b", name: "Beta", n: 2 },
      ]}
      columns={[
        {
          id: "name",
          header: "Name",
          cell: (r) => r.name,
          searchValue: (r) => r.name,
        },
        {
          id: "count",
          header: "Count",
          cell: (r) => r.n,
          sortValue: (r) => r.n,
        },
      ]}
      rowKey={(r) => r.id}
      selection={{ ids: [], onChange: change }}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Count" }));
  expect(
    within(screen.getAllByRole("row")[1]).getByText("Beta"),
  ).toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "Alpha");
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Select page" }));
  expect(change).toHaveBeenCalledWith(["a"]);
});
test("carousel handles bounds and keyboard", async () => {
  const change = vi.fn();
  render(
    <ImageCarousel
      label="Gallery"
      items={[
        { id: "a", src: "a.png", alt: "A" },
        { id: "b", src: "b.png", alt: "B" },
      ]}
      onIndexChange={change}
    />,
  );
  expect(screen.getByRole("button", { name: "Previous image" })).toBeDisabled();
  screen.getByRole("region", { name: "Gallery" }).focus();
  await userEvent.setup().keyboard("{ArrowRight}");
  expect(screen.getByRole("img")).toHaveAttribute("alt", "B");
  expect(change).toHaveBeenCalledWith(1);
  expect(screen.getByRole("button", { name: "Next image" })).toBeDisabled();
});
test("date controls preserve date strings and flag inverted range", () => {
  render(
    <>
      <DatePicker label="Due" value="2026-11-03" onValueChange={() => {}} />
      <DateRangePicker
        label="Range"
        value={{ start: "2026-11-04", end: "2026-11-03" }}
        onValueChange={() => {}}
      />
    </>,
  );
  expect(screen.getByLabelText("Due")).toHaveValue("2026-11-03");
  expect(screen.getByRole("alert")).toHaveTextContent("End date");
});
test("charts handle invalid donut and retain exact accessible data", () => {
  render(
    <>
      <Chart
        title="Revenue"
        kind="bar"
        data={[
          { label: "A", value: -2 },
          { label: "B", value: 4 },
        ]}
      />
      <Chart title="Invalid" kind="donut" data={[{ label: "A", value: -1 }]} />
    </>,
  );
  expect(screen.getByRole("img", { name: "Revenue" })).toBeInTheDocument();
  expect(
    screen.getByRole("cell", { name: "-2", hidden: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("nonnegative");
});
test("uploads reject oversize, retry failure, and complete", async () => {
  const upload = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined);
  render(<FileUpload label="Files" maxBytes={10} onUpload={upload} />);
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Files", { selector: "input" }),
    new File(["a".repeat(11)], "big.txt"),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("at most");
  await user.upload(
    screen.getByLabelText("Files", { selector: "input" }),
    new File(["ok"], "small.txt"),
  );
  await user.click(screen.getByRole("button", { name: /^Upload$/ }));
  expect(await screen.findByText("Offline")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry upload" }));
  expect(await screen.findByText("complete")).toBeInTheDocument();
  expect(upload).toHaveBeenCalledTimes(2);
});
test("upload cancellation aborts the supplied signal", async () => {
  let signal: AbortSignal | undefined;
  render(
    <FileUpload
      label="Files"
      onUpload={(_file, context) => {
        signal = context.signal;
        return new Promise(() => {});
      }}
    />,
  );
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Files", { selector: "input" }),
    new File(["ok"], "x.txt"),
  );
  await user.click(screen.getByRole("button", { name: "Upload" }));
  await user.click(screen.getByRole("button", { name: "Cancel upload" }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText("canceled")).toBeInTheDocument();
});
test("chat preserves draft after send error and blocks unsafe citation links", async () => {
  const send = vi.fn().mockRejectedValue(new Error("Offline"));
  render(
    <ChatPanel
      messages={[
        {
          id: "a",
          role: "assistant",
          text: "Hello",
          citations: [{ id: "x", label: "Unsafe", url: "javascript:alert(1)" }],
        },
      ]}
      onSend={send}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Message"), "Hi");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  expect(screen.getByLabelText("Message")).toHaveValue("Hi");
  expect(
    screen.queryByRole("link", { name: "Unsafe" }),
  ).not.toBeInTheDocument();
});
test("chat supports cancellation while streaming", async () => {
  const stop = vi.fn();
  render(<ChatPanel messages={[]} streaming onSend={() => {}} onStop={stop} />);
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Stop response" }));
  expect(stop).toHaveBeenCalledOnce();
});
test("navigation marks the current page", () => {
  render(
    <AppNavigation
      appName="App"
      activeId="home"
      items={[{ id: "home", label: "Home", href: "/" }]}
    />,
  );
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
test("advanced gallery renders", () => {
  render(<AdvancedGallery />);
  expect(
    screen.getByRole("heading", { name: "Advanced component gallery" }),
  ).toBeInTheDocument();
});

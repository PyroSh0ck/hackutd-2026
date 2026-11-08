"use client";
import { useEffect, useRef, useState } from "react";
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
  type ChatMessage,
  type DateRange,
} from "@/components/advanced";
import { Button, Card } from "@/components/ui";
import { TextField } from "@/components/forms";
import s from "@visual/advanced.module.css";
const art = (color: string, text: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="${color}"/><text x="400" y="240" text-anchor="middle" fill="white" font-size="48">${text}</text></svg>`)}`;
const gallery = [
  {
    id: "one",
    src: art("#2458d3", "First image"),
    alt: "Blue demonstration image",
    caption: "Replace with your artwork",
  },
  {
    id: "two",
    src: art("#16856b", "Second image"),
    alt: "Green demonstration image",
  },
];
function Examples() {
  const toast = useToast();
  const [choice, setChoice] = useState(""),
    [open, setOpen] = useState(false),
    [name, setName] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [date, setDate] = useState(""),
    [range, setRange] = useState<DateRange>({ start: "", end: "" });
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [streaming, setStreaming] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setStreaming(false);
  }
  function send(text: string) {
    const id = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text },
      { id, role: "assistant", text: "" },
    ]);
    setStreaming(true);
    let index = 0;
    const reply =
      "This is a simulated streaming response. Connect your own backend through onSend.";
    timer.current = setInterval(() => {
      index += 4;
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, text: reply.slice(0, index) }
            : message,
        ),
      );
      if (index >= reply.length) stop();
    }, 40);
  }
  return (
    <div className={s.stack}>
      <h1>Advanced component gallery</h1>
      <p>
        Functional UI demos. Upload and chat use local simulations, not external
        services.
      </p>
      <Card title="Application navigation">
        <AppNavigation
          appName="Hackathon starter"
          activeId="overview"
          items={[
            { id: "overview", label: "Overview", href: "#overview" },
            { id: "projects", label: "Projects", href: "#projects" },
          ]}
          account={{
            name: "Demo user",
            actions: [
              {
                id: "account",
                text: "Account",
                onSelect: () => toast({ title: "Account selected" }),
              },
            ],
          }}
        />
      </Card>
      <Card title="File upload">
        <FileUpload
          label="Upload demo files"
          accept=".txt,.pdf,image/*"
          onUpload={(file, { signal, onProgress }) =>
            new Promise<void>((resolve, reject) => {
              let percent = 0;
              const abort = () => {
                clearInterval(interval);
                reject(new Error("Canceled"));
              };
              const interval = setInterval(() => {
                percent += 20;
                onProgress(percent);
                if (percent >= 100) {
                  clearInterval(interval);
                  signal.removeEventListener("abort", abort);
                  toast({
                    title: `${file.name}: simulated upload complete`,
                    tone: "success",
                  });
                  resolve();
                }
              }, 150);
              signal.addEventListener("abort", abort, { once: true });
            })
          }
        />
      </Card>
      <Card title="Searchable selection and notifications">
        <Combobox
          label="Framework"
          options={[
            { value: "next", label: "Next.js" },
            { value: "react", label: "React" },
            { value: "vue", label: "Vue" },
          ]}
          value={choice}
          onValueChange={setChoice}
        />
        <Button
          text="Show notification"
          onClick={() =>
            toast({
              title: "Saved",
              description: "Example notification",
              tone: "success",
            })
          }
        />
      </Card>
      <Card title="Guided form">
        <Stepper
          steps={[
            {
              id: "name",
              title: "Name",
              content: (
                <TextField
                  label="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              ),
              validate: () =>
                name.trim() ? undefined : "Enter a project name.",
            },
            { id: "review", title: "Review", content: <p>Project: {name}</p> },
          ]}
          onComplete={() =>
            toast({ title: "Wizard complete", tone: "success" })
          }
        />
      </Card>
      <Card title="Drawer and accordion">
        <Drawer
          triggerText="Open filters"
          title="Filters"
          description="Adjust your view"
          open={open}
          onOpenChange={setOpen}
        >
          <p>Place filter controls here.</p>
        </Drawer>
        <Accordion
          items={[
            {
              id: "a",
              title: "Where do handlers live?",
              content: <p>Business handlers live in the consuming feature.</p>,
            },
            {
              id: "b",
              title: "Can I replace the visuals?",
              content: <p>Edit advanced.module.css and internal artwork.</p>,
            },
          ]}
        />
      </Card>
      <Card title="Data table">
        <DataTable
          caption="Projects"
          rows={[
            { id: "1", name: "Atlas", count: 12 },
            { id: "2", name: "Birch", count: 4 },
            { id: "3", name: "Cedar", count: 22 },
          ]}
          columns={[
            {
              id: "name",
              header: "Name",
              cell: (r) => r.name,
              sortValue: (r) => r.name,
            },
            {
              id: "count",
              header: "Tasks",
              cell: (r) => r.count,
              sortValue: (r) => r.count,
            },
          ]}
          rowKey={(r) => r.id}
          pageSize={2}
          selection={{ ids: selection, onChange: setSelection }}
          rowActions={(r) => [
            {
              id: "edit",
              text: "Edit",
              onSelect: () => toast({ title: `Edit ${r.name}` }),
            },
          ]}
        />
      </Card>
      <Card title="Charts">
        <div className={s.grid}>
          {(["line", "bar", "donut"] as const).map((kind) => (
            <Chart
              key={kind}
              title={`${kind} example`}
              kind={kind}
              data={[
                { label: "Mon", value: 12 },
                { label: "Tue", value: 24 },
                { label: "Wed", value: 17 },
              ]}
            />
          ))}
        </div>
      </Card>
      <Card title="Image carousel">
        <ImageCarousel label="Project screenshots" items={gallery} />
      </Card>
      <Card title="Dates">
        <DatePicker label="Due date" value={date} onValueChange={setDate} />
        <DateRangePicker
          label="Reporting range"
          value={range}
          onValueChange={setRange}
        />
      </Card>
      <Card title="Chat">
        <ChatPanel
          messages={messages}
          streaming={streaming}
          onSend={send}
          onStop={stop}
        />
      </Card>
    </div>
  );
}
export function AdvancedGallery() {
  return (
    <ToastProvider>
      <Examples />
    </ToastProvider>
  );
}

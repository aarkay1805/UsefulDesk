"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The searchable "modules" map to this app's real sections. Only the ones
// in SEARCHABLE currently support the `?search=` query on their list page;
// the rest just navigate to the section (search wiring comes later).
const MODULES = [
  { label: "All Modules", href: "/leads" },
  { label: "Leads", href: "/leads" },
  { label: "Inbox", href: "/inbox" },
  { label: "Broadcasts", href: "/broadcasts" },
  { label: "Automations", href: "/automations" },
] as const;

const SEARCHABLE = new Set<string>(["All Modules", "Leads"]);

export function GlobalSearch() {
  const router = useRouter();

  // Collapsed by default (Zoho-style) — a compact button that expands into
  // the full search field with the module selector on click.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [module, setModule] = useState<string>("All Modules");
  const [moduleOpen, setModuleOpen] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Autofocus the field the moment it expands.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Collapse when the user clicks outside the expanded field. The module
  // popover is portalled, so keep the field open while it's interacting.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (moduleOpen) return;
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, moduleOpen]);

  function submit() {
    const q = query.trim();
    const target = MODULES.find((m) => m.label === module) ?? MODULES[0];
    if (SEARCHABLE.has(module)) {
      router.push(`/leads${q ? `?search=${encodeURIComponent(q)}` : ""}`);
    } else {
      router.push(target.href);
    }
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search records"
        className="flex w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search records</span>
      </button>
    );
  }

  const filteredModules = MODULES.filter((m) =>
    m.label.toLowerCase().includes(moduleFilter.trim().toLowerCase())
  );

  return (
    <div
      ref={containerRef}
      className="flex w-full max-w-2xl items-center rounded-lg border border-ring bg-card shadow-sm ring-3 ring-ring/20"
    >
      {/* Module selector */}
      <Popover open={moduleOpen} onOpenChange={setModuleOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-l-lg border-r border-border px-3 py-2 text-sm font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted"
            />
          }
        >
          {module}
          <ChevronDown className="size-4 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <div className="border-b border-border p-2">
            <Input
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              placeholder="Search Modules"
              className="h-8 bg-card"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredModules.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                No modules found.
              </p>
            ) : (
              filteredModules.map((m) => {
                const active = m.label === module;
                return (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => {
                      setModule(m.label);
                      setModuleOpen(false);
                      inputRef.current?.focus();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/50",
                      active
                        ? "font-medium text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        active ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Query field */}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search records..."
          className="w-full rounded-r-lg bg-transparent py-2 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
    </div>
  );
}

import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    // Account rows in lead_field_options (field='status'). Empty array
    // = account uses the built-in defaults, mirroring production.
    leadFieldOptions: [] as { key: string }[],
    // Account staff roster (profiles reads — assign_lead round-robin).
    roster: [] as { user_id: string }[],
    // When set, follow_ups inserts fail with this error (23505 tests).
    followUpInsertError: null as { code: string; message: string } | null,
    followUpInserts: [] as unknown[],
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as {
      table: string;
      filters: [string, string, unknown][];
      payload?: unknown;
    }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters, payload: ops.payload });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "lead_field_options") {
      return { data: state.leadFieldOptions, error: null };
    }
    if (table === "profiles") {
      return { data: state.roster, error: null };
    }
    if (table === "follow_ups") {
      if (type === "insert") {
        if (state.followUpInsertError) {
          return { data: null, error: state.followUpInsertError };
        }
        state.followUpInserts.push(ops.payload);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "automation_logs") {
      if (type === "insert") return { data: { id: "log1" }, error: null };
      if (type === "update") return { data: null, error: null };
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") return { data: state.steps, error: null };
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import { runAutomationsForTrigger } from "./engine";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.leadFieldOptions = [];
  h.state.roster = [];
  h.state.followUpInsertError = null;
  h.state.followUpInserts = [];
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("set_lead_status", () => {
  it("writes the status to contacts scoped to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [leadStatusStep("interested")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const call = h.state.updateCalls[0];
    expect(call.filters).toContainEqual(["eq", "id", "c1"]);
    expect(call.filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect((call.payload as { lead_status: string }).lead_status).toBe(
      "interested",
    );
  });

  it("stores 'new' as NULL (back to the New board column)", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [leadStatusStep("new")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    expect(
      (h.state.updateCalls[0].payload as { lead_status: string | null })
        .lead_status,
    ).toBeNull();
  });

  it("rejects a status outside the default list without writing", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [leadStatusStep("won")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The step throws (logged as failed) — no contacts write happens.
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("allows a custom status when the account's list defines it", async () => {
    h.state.owned = { id: "c1" };
    // Account replaced the defaults with its own list (migration 042).
    h.state.leadFieldOptions = [{ key: "contacted" }, { key: "won" }];
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [leadStatusStep("won")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    expect(
      (h.state.updateCalls[0].payload as { lead_status: string }).lead_status,
    ).toBe("won");
  });

  it("rejects a default status the account's saved list has removed", async () => {
    h.state.owned = { id: "c1" };
    h.state.leadFieldOptions = [{ key: "contacted" }];
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [leadStatusStep("interested")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("assign_lead", () => {
  it("writes a specific teammate to contacts.assigned_to, account-scoped", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [step("assign_lead", { mode: "specific", agent_id: "agent-9" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const call = h.state.updateCalls[0];
    expect(call.filters).toContainEqual(["eq", "id", "c1"]);
    expect(call.filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect((call.payload as { assigned_to: string }).assigned_to).toBe("agent-9");
  });

  it("round-robin picks a roster member deterministically", async () => {
    h.state.owned = { id: "c1" };
    h.state.roster = [{ user_id: "u-a" }, { user_id: "u-b" }];
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [step("assign_lead", { mode: "round_robin" })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const picked = (h.state.updateCalls[0].payload as { assigned_to: string })
      .assigned_to;
    expect(["u-a", "u-b"]).toContain(picked);

    // Same contact → same pick on a second run (stateless determinism).
    h.state.updateCalls = [];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });
    expect(
      (h.state.updateCalls[0].payload as { assigned_to: string }).assigned_to,
    ).toBe(picked);
  });

  it("skips when only_if_unassigned and the lead already has an owner", async () => {
    // The contacts read returns assigned_to for the pre-check.
    h.state.owned = { id: "c1", assigned_to: "u-existing" } as never;
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      step("assign_lead", {
        mode: "specific",
        agent_id: "agent-9",
        only_if_unassigned: true,
      }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("create_follow_up", () => {
  it("inserts an open task owned by the automation author by default", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      step("create_follow_up", {
        task_type: "call",
        due_in_days: 2,
        assign_mode: "lead_owner",
      }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.followUpInserts).toHaveLength(1);
    const row = h.state.followUpInserts[0] as Record<string, unknown>;
    expect(row.account_id).toBe(ACCOUNT);
    expect(row.contact_id).toBe("c1");
    expect(row.task_type).toBe("call");
    // Lead has no owner in this mock → falls back to the automation author.
    expect(row.assigned_to).toBe("u1");
    expect(row.created_by).toBe("u1");
    expect(String(row.due_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prefers the lead's owner when assigned", async () => {
    h.state.owned = { id: "c1", assigned_to: "u-owner" } as never;
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      step("create_follow_up", {
        task_type: "todo",
        due_in_days: 0,
        assign_mode: "lead_owner",
      }),
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(
      (h.state.followUpInserts[0] as Record<string, unknown>).assigned_to,
    ).toBe("u-owner");
  });

  it("treats the one-open-task-per-contact conflict as a skip, not a failure", async () => {
    h.state.owned = { id: "c1" };
    h.state.followUpInsertError = { code: "23505", message: "duplicate" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      step("create_follow_up", {
        task_type: "call",
        due_in_days: 1,
        assign_mode: "lead_owner",
      }),
    ];

    // Must not throw — the run should complete normally.
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.followUpInserts).toHaveLength(0);
  });
});

function step(step_type: string, step_config: Record<string, unknown>) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type,
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function leadStatusStep(status: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "set_lead_status",
    position: 0,
    parent_step_id: null,
    step_config: { status },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

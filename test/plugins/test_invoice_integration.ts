// End-to-end integration test for the Invoice plugin.
// Loads the workspace-built `dist/index.js` through the real
// runtime loader with a real `makePluginRuntime`, then exercises the
// settings and candidate → invoice → paid → void flow against an isolated tmp workspace.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime } from "../../server/plugins/runtime.js";
import { createTaskManager } from "../../server/events/task-manager/index.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/plugins/invoice-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/invoice-plugin";
const VERSION = "0.1.0";

function makeRecordingPubSub(): { pubsub: IPubSub; published: { channel: string; data: unknown }[] } {
  const published: { channel: string; data: unknown }[] = [];
  return {
    pubsub: {
      publish(channel, data) {
        published.push({ channel, data });
      },
    },
    published,
  };
}

interface TestInvoiceResultData {
  candidate?: {
    candidateId: string;
    clientId?: string;
  };
  candidates?: {
    candidateId: string;
    clientId?: string;
  }[];
  invoice?: {
    id: string;
    notes: string;
    status: string;
    paymentRef?: string;
  };
  invoices?: {
    id: string;
    notes: string;
    status: string;
    paymentRef?: string;
  }[];
  settings?: {
    companyName: string;
  };
  clients?: {
    id: string;
    name: string;
  }[];
  prompt?: string;
  chatId?: string;
}

interface InvoiceResult {
  ok: boolean;
  message?: string;
  error?: string;
  jsonData?: TestInvoiceResultData;
  data?: Record<string, unknown>;
}

describe("Invoice plugin — end-to-end integration through the loader", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[invoice integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/plugins/invoice-plugin/`);
    }
  });

  let savedDataDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "invoice-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "invoice-int-config-"));
    process.env.MULMOCLAUDE_WORKSPACE_PATH = dataRoot;
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  // eslint-disable-next-line complexity -- giant end-to-end happy path testing settings round-trip + full candidate promotion lifecycle sequentially
  it("performs full candidate lifecycle: create, list, approve/journal, mark-paid, void, settings", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageInvoice");
    assert.ok(plugin.execute, "execute handler must be present");

    // 1. Initial settings should be empty defaults
    let res = (await plugin.execute({}, { action: "getSettings" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.deepEqual(res.jsonData?.settings, {
      companyName: "",
      taxRegistrationId: "",
      postalCode: "",
      address: "",
      email: "",
      bankName: "",
      bankBranch: "",
      bankAccountType: "",
      bankAccountNumber: "",
      bankAccountHolder: "",
      bookId: "",
      bookName: "",
    });

    // 2. Save issuer profile settings
    const testSettings = {
      companyName: "Acme Corp",
      taxRegistrationId: "T1234567890123",
      email: "billing@acme.com",
      postalCode: "100-0001",
      address: "1-1 Chiyoda",
      bankName: "Mega Bank",
      bankBranch: "Tokyo Branch",
      bankAccountType: "checking",
      bankAccountNumber: "9876543",
      bankAccountHolder: "ACME CORP",
      bookId: "book-test",
      bookName: "Acme General Ledger",
    };
    res = (await plugin.execute({}, { action: "saveSettings", settings: testSettings })) as InvoiceResult;
    assert.equal(res.ok, true);

    // 3. Confirm settings persisted
    res = (await plugin.execute({}, { action: "getSettings" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.deepEqual(res.jsonData?.settings, testSettings);

    // 4. List on empty workspace should return no candidates or invoices
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.deepEqual(res.jsonData?.candidates, []);
    assert.deepEqual(res.jsonData?.invoices, []);

    // 5. Create a candidate draft invoice
    const candidateData = {
      clientId: "client-abc",
      date: "2026-05-23",
      dueDate: "2026-06-30",
      items: [{ description: "Software development consulting", quantity: 10, rate: 15000, amount: 150000 }],
      subtotal: 150000,
      tax: 15000,
      total: 165000,
      notes: "First project milestone",
    };
    res = (await plugin.execute({}, { action: "createCandidate", ...candidateData })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.ok(res.jsonData?.candidate?.candidateId);
    const { candidateId } = res.jsonData.candidate;

    // 6. List and confirm candidate exists
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.equal(res.jsonData?.candidates?.length, 1);
    assert.equal(res.jsonData?.invoices?.length, 0);
    assert.equal(res.jsonData.candidates[0].candidateId, candidateId);
    assert.equal(res.jsonData.candidates[0].clientId, "client-abc");

    // 7. Approve candidate to commit it as an invoice
    res = (await plugin.execute({}, { action: "candidateApprove", id: candidateId })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.ok(res.jsonData?.invoice?.id);
    const invoiceId = res.jsonData.invoice.id;

    // 8. Confirm list has 0 candidates and 1 committed invoice (status 'approved')
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.equal(res.jsonData?.candidates?.length, 0);
    assert.equal(res.jsonData?.invoices?.length, 1);
    assert.equal(res.jsonData.invoices[0].id, invoiceId);
    assert.equal(res.jsonData.invoices[0].status, "approved");

    // 9. Mark invoice as Paid
    res = (await plugin.execute({}, { action: "invoiceMarkPaid", id: invoiceId, paymentRef: "Bank Wire Ref 999" })) as InvoiceResult;
    assert.equal(res.ok, true);

    // 10. Confirm committed invoice is now 'paid'
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.equal(res.jsonData?.invoices?.length, 1);
    assert.equal(res.jsonData.invoices[0].status, "paid");
    assert.equal(res.jsonData.invoices[0].paymentRef, "Bank Wire Ref 999");

    // 11. Void the paid invoice
    res = (await plugin.execute({}, { action: "invoiceVoid", id: invoiceId, voidReason: "Client request change" })) as InvoiceResult;
    assert.equal(res.ok, true);

    // 12. Confirm invoice is now 'voided'
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.ok, true);
    assert.equal(res.jsonData?.invoices?.length, 1);
    assert.equal(res.jsonData.invoices[0].status, "void");
    assert.match(res.jsonData.invoices[0].notes, /Client request change/);

    // 13. Verify pubsub change notifications were triggered
    const changedEvents = published.filter((event) => event.channel === `plugin:${PKG_NAME}:changed`);
    assert.ok(changedEvents.length >= 4, "Should emit changed events for create, approve, paid, and void");
  });

  it("can delete candidate drafts", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    // Save issuer settings first so creation is allowed
    const testSettings = {
      companyName: "Acme Corp",
      taxRegistrationId: "T1234567890123",
      email: "billing@acme.com",
      postalCode: "100-0001",
      address: "1-1 Chiyoda",
      bankName: "Mega Bank",
      bankBranch: "Tokyo Branch",
      bankAccountType: "checking",
      bankAccountNumber: "9876543",
      bankAccountHolder: "ACME CORP",
      bookId: "book-test",
      bookName: "Acme General Ledger",
    };
    await plugin.execute({}, { action: "saveSettings", settings: testSettings });

    // Create a candidate
    let res = (await plugin.execute(
      {},
      {
        action: "createCandidate",
        clientId: "client-xyz",
        date: "2026-05-23",
        dueDate: "2026-06-30",
        items: [{ description: "Consulting", quantity: 2, rate: 100, amount: 200 }],
        subtotal: 200,
        tax: 20,
        total: 220,
        notes: "Testing candidate deletion",
      },
    )) as InvoiceResult;
    assert.equal(res.ok, true);
    const candidateId = res.jsonData?.candidate?.candidateId;
    assert.ok(candidateId);

    // List to check candidate exists
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.jsonData?.candidates?.length, 1);

    // Delete candidate
    res = (await plugin.execute({}, { action: "candidateDelete", id: candidateId })) as InvoiceResult;
    assert.equal(res.ok, true);

    // List again to verify candidate is gone
    res = (await plugin.execute({}, { action: "list" })) as InvoiceResult;
    assert.equal(res.jsonData?.candidates?.length, 0);
  });
});

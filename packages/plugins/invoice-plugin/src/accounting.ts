import { importServerModule } from "./server-imports";
import type { Invoice } from "./types";
import type { FileOps } from "gui-chat-protocol";
import { loadSettings } from "./io";

/**
 * Resolves the appropriate bookId to post entries into.
 * Prefers bookId configured in settings, then falls back to a book named "Pervasive" (case-insensitive),
 * then one with JP country code, and finally defaults to the first available book.
 */
async function resolveActiveBook(log: any, files?: FileOps): Promise<string | null> {
  try {
    // 1. Try to load bookId from issuer settings
    if (files) {
      const settings = await loadSettings(files);
      if (settings.bookId) {
        log.info("invoice-accounting", `Using target bookId from issuer settings: ${settings.bookId}`);
        return settings.bookId;
      }
    }

    const service = await importServerModule("server/accounting/service");
    if (!service || typeof service.listBooks !== "function") {
      log.warn("invoice-accounting", "Accounting service listBooks is not available");
      return null;
    }

    const { books } = await service.listBooks();
    if (!books || books.length === 0) {
      log.warn("invoice-accounting", "No books found in Accounting config");
      return null;
    }

    // 2. Try to find a book named "Pervasive"
    const pervasiveBook = books.find((b: any) => b.name && b.name.toLowerCase().includes("pervasive"));
    if (pervasiveBook) {
      log.info("invoice-accounting", `Using book 'Pervasive' with ID: ${pervasiveBook.id}`);
      return pervasiveBook.id;
    }

    // 2. Try to find any JP book
    const jpBook = books.find((b: any) => b.country === "JP");
    if (jpBook) {
      log.info("invoice-accounting", `Using JP book with ID: ${jpBook.id}`);
      return jpBook.id;
    }

    // 3. Default to the first book
    log.info("invoice-accounting", `Defaulting to the first available book with ID: ${books[0].id}`);
    return books[0].id;
  } catch (err: any) {
    log.warn("invoice-accounting", "Failed to resolve active book", { error: err.message });
    return null;
  }
}

/**
 * Record dynamic double-entry bookkeeping when an invoice is approved.
 * Debit Accounts Receivable (1100) for the total.
 * Credit Sales/Revenue (4000) for the subtotal.
 * Credit Sales Tax Payable (2400) for the tax (if tax > 0 and 2400 exists).
 */
export async function recordInvoiceApproval(invoice: Invoice, clientName: string, log: any, files?: FileOps): Promise<void> {
  try {
    const bookId = await resolveActiveBook(log, files);
    if (!bookId) return;

    const service = await importServerModule("server/accounting/service");
    if (!service || typeof service.addEntries !== "function") {
      log.warn("invoice-accounting", "addEntries is not exported by accounting service");
      return;
    }

    // Check if account 2400 (Sales Tax Payable) exists in this book
    let hasTaxAccount = false;
    try {
      const { accounts } = await service.listAccounts({ bookId });
      hasTaxAccount = accounts.some((acc: any) => acc.code === "2400" && acc.active !== false);
    } catch {
      // Graceful fallback to false
    }

    const lines: any[] = [
      {
        accountCode: "1100", // Accounts Receivable
        debit: invoice.total,
        memo: `AR - INV ${invoice.id}`,
      },
    ];

    if (invoice.tax > 0 && hasTaxAccount) {
      lines.push({
        accountCode: "4000", // Revenue / Sales
        credit: invoice.subtotal,
        memo: `Sales - INV ${invoice.id}`,
      });
      lines.push({
        accountCode: "2400", // Sales Tax Payable
        credit: invoice.tax,
        memo: `Consumption Tax - INV ${invoice.id}`,
      });
    } else {
      lines.push({
        accountCode: "4000", // Revenue / Sales
        credit: invoice.total,
        memo: `Sales (incl. tax) - INV ${invoice.id}`,
      });
    }

    await service.addEntries({
      bookId,
      entries: [
        {
          date: invoice.date,
          memo: `[Approved] Invoice ${invoice.id} for ${clientName}`,
          lines,
        },
      ],
    });

    log.info("invoice-accounting", `Successfully logged invoice approval in book ${bookId} for INV ${invoice.id}`);
  } catch (err: any) {
    log.error("invoice-accounting", `Failed to record invoice approval for INV ${invoice.id}`, { error: err.message });
  }
}

/**
 * Record cash receipt when an invoice is marked paid.
 * Debit Checking Bank (1010) or Cash (1000) for the total.
 * Credit Accounts Receivable (1100) for the total.
 */
export async function recordInvoicePayment(invoice: Invoice, log: any, files?: FileOps): Promise<void> {
  try {
    const bookId = await resolveActiveBook(log, files);
    if (!bookId) return;

    const service = await importServerModule("server/accounting/service");
    if (!service || typeof service.addEntries !== "function") {
      log.warn("invoice-accounting", "addEntries is not exported by accounting service");
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    await service.addEntries({
      bookId,
      entries: [
        {
          date: todayStr,
          memo: `[Payment] Invoice ${invoice.id}${invoice.paymentRef ? ` - ${invoice.paymentRef}` : ""}`,
          lines: [
            {
              accountCode: "1010", // Bank checking
              debit: invoice.total,
              memo: `Deposit - INV ${invoice.id}`,
            },
            {
              accountCode: "1100", // Accounts Receivable
              credit: invoice.total,
              memo: `AR Credit - INV ${invoice.id}`,
            },
          ],
        },
      ],
    });

    log.info("invoice-accounting", `Successfully logged invoice payment in book ${bookId} for INV ${invoice.id}`);
  } catch (err: any) {
    log.error("invoice-accounting", `Failed to record invoice payment for INV ${invoice.id}`, { error: err.message });
  }
}

/**
 * Scan entries in the active book for any with memo or line memos containing invoice.id,
 * and call voidEntry to reverse them.
 */
export async function recordInvoiceVoid(invoice: Invoice, log: any, files?: FileOps): Promise<void> {
  try {
    const bookId = await resolveActiveBook(log, files);
    if (!bookId) return;

    const service = await importServerModule("server/accounting/service");
    if (!service || typeof service.listEntries !== "function" || typeof service.voidEntry !== "function") {
      log.warn("invoice-accounting", "listEntries or voidEntry is not available");
      return;
    }

    // List all entries in the book
    const { entries } = await service.listEntries({ bookId });
    if (!entries || entries.length === 0) return;

    // Filter entries that match this invoice ID in their memo or line memo
    const matchingEntries = entries.filter((entry: any) => {
      const memoMatch = entry.memo && entry.memo.includes(invoice.id);
      const lineMatch = entry.lines && entry.lines.some((line: any) => line.memo && line.memo.includes(invoice.id));
      return memoMatch || lineMatch;
    });

    if (matchingEntries.length === 0) {
      log.info("invoice-accounting", `No matching journal entries found to void for INV ${invoice.id}`);
      return;
    }

    log.info("invoice-accounting", `Found ${matchingEntries.length} entries to void for INV ${invoice.id}`);

    for (const entry of matchingEntries) {
      try {
        await service.voidEntry({
          bookId,
          entryId: entry.id,
          reason: `Invoice ${invoice.id} voided`,
        });
        log.info("invoice-accounting", `Successfully voided journal entry ${entry.id} for INV ${invoice.id}`);
      } catch (voidErr: any) {
        log.warn("invoice-accounting", `Failed to void individual entry ${entry.id}`, { error: voidErr.message });
      }
    }
  } catch (err: any) {
    log.error("invoice-accounting", `Failed to scan and void journal entries for INV ${invoice.id}`, { error: err.message });
  }
}

/**
 * Resolves the country of the active book dynamically.
 */
export async function getActiveBookCountry(log: any, files?: FileOps): Promise<string> {
  try {
    const bookId = await resolveActiveBook(log, files);
    if (!bookId) return "US";

    const service = await importServerModule("server/accounting/service");
    if (!service || typeof service.listBooks !== "function") {
      return "US";
    }

    const { books } = await service.listBooks();
    const book = books.find((b: any) => b.id === bookId);
    return book?.country || "US";
  } catch (err: any) {
    log.warn("invoice-accounting", "Failed to resolve active book country", { error: err.message });
    return "US";
  }
}

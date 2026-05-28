// IMAP client wrapper. Uses imapflow for the protocol and
// mailparser for MIME → structured body conversion.
//
// Connection lifecycle: each operation opens a fresh ImapFlow
// connection, runs the command, then closes. For v1 this keeps
// the implementation simple at the cost of a TLS handshake per
// call. A pooled long-lived connection is a v2 optimisation —
// Gmail's IMAP keepalive limits would matter once we add IDLE
// for push notifications. See #1542.
//
// All public functions throw on network / auth errors; the
// dispatcher in `index.ts` catches and converts to the
// `instructions` payload shape so the LLM stays in the loop.

import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";

import type { HostPort } from "./providers";

export interface ImapAuth {
  email: string;
  password: string;
  imap: HostPort;
}

export interface ListedMessage {
  uid: number;
  subject: string;
  from: string;
  date: string | null;
  unread: boolean;
  snippet: string;
}

export interface FullMessage {
  uid: number;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string | null;
  text: string;
  html: string | null;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
}

export interface SearchCriteria {
  from?: string;
  subject_contains?: string;
  since?: string; // ISO date
  before?: string; // ISO date
  unread?: boolean;
}

function makeClient(auth: ImapAuth): ImapFlow {
  return new ImapFlow({
    host: auth.imap.host,
    port: auth.imap.port,
    secure: auth.imap.secure,
    auth: { user: auth.email, pass: auth.password },
    logger: false,
  });
}

// imapflow envelope addresses are `{name, address}`; render them
// the way humans expect for the list view ("Alice <a@x.com>").
function renderAddress(addrs: AddressObject | AddressObject[] | undefined): string {
  return addressList(addrs).join(", ");
}

// Structured per-address rendering. Returns one element per
// address so a display name containing a comma (e.g.
// `"Doe, John" <john@example.com>`) doesn't get sliced apart by
// the caller — joining + splitting on `", "` is what the previous
// version did and what Codex flagged. Build arrays from
// `AddressObject.value[]` directly instead.
export function addressList(addrs: AddressObject | AddressObject[] | undefined): string[] {
  if (!addrs) return [];
  const arr = Array.isArray(addrs) ? addrs : [addrs];
  return arr
    .flatMap((a) => a.value)
    .map((v) => (v.name ? `${v.name} <${v.address ?? ""}>` : (v.address ?? "")))
    .filter((s) => s.length > 0);
}

function renderEnvelopeAddress(arr: ReadonlyArray<{ name?: string | null; address?: string | null }> | null | undefined): string {
  if (!arr || arr.length === 0) return "";
  return arr
    .map((v) => (v.name ? `${v.name} <${v.address ?? ""}>` : (v.address ?? "")))
    .filter((s) => s.length > 0)
    .join(", ");
}

function envelopeToSummary(msg: FetchMessageObject): ListedMessage {
  return {
    uid: Number(msg.uid),
    subject: msg.envelope?.subject ?? "(no subject)",
    from: renderEnvelopeAddress(msg.envelope?.from),
    date: msg.envelope?.date ? msg.envelope.date.toISOString() : null,
    unread: !msg.flags?.has("\\Seen"),
    snippet: "",
  };
}

/** List the N newest messages in a mailbox (newest first). */
export async function listMessages(auth: ImapAuth, mailbox: string, limit: number): Promise<ListedMessage[]> {
  const client = makeClient(auth);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const total = (client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0) ?? 0;
      if (total === 0) return [];
      const startSeq = Math.max(1, total - limit + 1);
      const out: ListedMessage[] = [];
      for await (const msg of client.fetch(`${startSeq}:*`, { uid: true, envelope: true, flags: true })) {
        out.push(envelopeToSummary(msg));
      }
      // imapflow returns sequence-ascending; reverse so newest is first.
      return out.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Fetch the full body (text/html/attachments) for one message. */
export async function readMessage(auth: ImapAuth, mailbox: string, uid: number): Promise<FullMessage> {
  const client = makeClient(auth);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const raw = await client.fetchOne(String(uid), { uid: true, envelope: true, source: true }, { uid: true });
      if (!raw || !raw.source) throw new Error(`uid ${uid} not found in ${mailbox}`);
      const parsed: ParsedMail = await simpleParser(raw.source);
      return {
        uid: Number(raw.uid),
        subject: parsed.subject ?? raw.envelope?.subject ?? "(no subject)",
        from: renderAddress(parsed.from),
        to: addressList(parsed.to),
        cc: addressList(parsed.cc),
        date: parsed.date ? parsed.date.toISOString() : null,
        text: parsed.text ?? "",
        html: typeof parsed.html === "string" ? parsed.html : null,
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? "(unnamed)",
          contentType: a.contentType ?? "application/octet-stream",
          size: a.size ?? 0,
        })),
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/** Build an IMAP SEARCH query from our criteria. Each field is a
 *  conjunction (AND); empty criteria → "ALL" (no filter). */
function buildSearchQuery(criteria: SearchCriteria): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (criteria.from) query.from = criteria.from;
  if (criteria.subject_contains) query.subject = criteria.subject_contains;
  if (criteria.since) query.since = new Date(criteria.since);
  if (criteria.before) query.before = new Date(criteria.before);
  if (criteria.unread === true) query.unseen = true;
  if (criteria.unread === false) query.seen = true;
  return query;
}

/** IMAP SEARCH + envelope FETCH. Returns newest first, capped by limit. */
export async function searchMessages(auth: ImapAuth, mailbox: string, criteria: SearchCriteria, limit: number): Promise<ListedMessage[]> {
  const client = makeClient(auth);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const query = buildSearchQuery(criteria);
      const uids = (await client.search(query, { uid: true })) || [];
      if (uids.length === 0) return [];
      // Newest first — UIDs are monotonically assigned, so a
      // descending sort matches arrival order well enough for v1.
      const ordered = [...uids].sort((a, b) => Number(b) - Number(a)).slice(0, limit);
      const out: ListedMessage[] = [];
      for await (const msg of client.fetch(ordered.join(","), { uid: true, envelope: true, flags: true }, { uid: true })) {
        out.push(envelopeToSummary(msg));
      }
      return out.sort((a, b) => b.uid - a.uid);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

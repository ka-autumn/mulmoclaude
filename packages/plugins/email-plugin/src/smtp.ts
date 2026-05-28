// SMTP send wrapper. nodemailer handles the transport (AUTH PLAIN
// for App Password, STARTTLS or TLS-on-connect depending on the
// resolved port). One transporter per call for v1 to match the
// IMAP side; pooling is a v2 optimisation.

import nodemailer from "nodemailer";

import type { HostPort } from "./providers";

export interface SmtpAuth {
  email: string;
  password: string;
  smtp: HostPort;
}

export interface SendDraft {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export async function sendMail(auth: SmtpAuth, draft: SendDraft): Promise<SendResult> {
  const transporter = nodemailer.createTransport({
    host: auth.smtp.host,
    port: auth.smtp.port,
    secure: auth.smtp.secure,
    auth: { user: auth.email, pass: auth.password },
  });
  try {
    const info = await transporter.sendMail({
      from: auth.email,
      to: draft.to,
      subject: draft.subject,
      text: draft.body,
      ...(draft.html ? { html: draft.html } : {}),
    });
    const accepted = (info.accepted ?? []).map((a) => (typeof a === "string" ? a : (a.address ?? ""))).filter((s) => s.length > 0);
    const rejected = (info.rejected ?? []).map((a) => (typeof a === "string" ? a : (a.address ?? ""))).filter((s) => s.length > 0);
    // nodemailer resolves successfully when the SMTP handshake +
    // DATA upload succeed, even if the server rejected every
    // recipient (RCPT TO 550). Treat zero-accepted as a hard
    // failure so the dispatcher surfaces it to the LLM as an
    // error instead of a false-positive "sent!". Codex review
    // caught this.
    if (accepted.length === 0) {
      const detail = rejected.length > 0 ? `rejected recipients: ${rejected.join(", ")}` : "no recipients accepted";
      throw new Error(`SMTP send rejected all recipients — ${detail}`);
    }
    return { messageId: info.messageId, accepted, rejected };
  } finally {
    transporter.close();
  }
}

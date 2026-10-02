import nodemailer from "nodemailer";
import { getSettings } from "@/lib/settings";

/**
 * Real delivery for the three channels in Settings → API.
 *
 * Each sender is a small adapter over one provider HTTP/SMTP call. Nothing
 * here talks to the database: the caller decides what to send and records the
 * result, so a provider outage can never leave a half-written message row.
 *
 * With no credentials configured a channel reports `configured: false` and the
 * caller records the message as `Pending` rather than pretending it went out —
 * the demo data stays visible without lying about delivery.
 */
export type Channel = "SMS" | "Email" | "WhatsApp";

export type SendResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string; retriable?: boolean };

export type SendOutcome = SendResult & { configured: boolean };

/* ------------------------------------------------------------------ */
/* SMS — BulkSMSBD style HTTP API, the default in Settings              */
/* ------------------------------------------------------------------ */

async function sendSms(to: string, body: string): Promise<SendOutcome> {
  const s = await getSettings();
  const url = s["api.smsUrl"];
  const key = s["api.smsApiKey"];
  const senderId = s["api.smsSenderId"];

  if (!url || !key) {
    return {
      ok: false,
      configured: false,
      error: "SMS provider is not configured.",
    };
  }

  // Bangladeshi numbers are sent without a leading 0 or +.
  const number = to.replace(/^\+?880/, "").replace(/^0/, "");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        sender_id: senderId,
        route: "sms",
        number,
        sms: body,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        error: `SMS provider returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    // BulkSMSBD answers with a code; 200 means accepted for delivery.
    try {
      const body = JSON.parse(text) as {
        code?: string | number;
        message?: string;
      };
      if (body.code !== undefined && String(body.code) !== "200") {
        return {
          ok: false,
          configured: true,
          error: body.message ?? `Provider code ${body.code}`,
        };
      }
      return { ok: true, configured: true };
    } catch {
      return { ok: true, configured: true };
    }
  } catch (e) {
    return {
      ok: false,
      configured: true,
      error: e instanceof Error ? e.message : "SMS request failed",
      retriable: true,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Email — SMTP relay                                                  */
/* ------------------------------------------------------------------ */

async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<SendOutcome> {
  const s = await getSettings();
  const host = s["api.emailSmtpHost"];
  const port = Number(s["api.emailSmtpPort"] ?? 587);
  const user = s["api.emailSmtpUser"];
  const pass = s["api.emailSmtpPass"];
  const secure = s["api.emailSmtpSecure"] === "true";
  const from = s["api.emailSmtpUser"] || s["company.email"];

  if (!host || !user || !pass) {
    return {
      ok: false,
      configured: false,
      error: "SMTP relay is not configured.",
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      // Development hosts often present a self-signed certificate.
      tls: { rejectUnauthorized: false },
    });
    const info = await transport.sendMail({
      from: `${s["company.name"] ?? "ISP"} <${from}>`,
      to,
      subject,
      text: body,
    });
    return { ok: true, configured: true, providerId: info.messageId };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      error: e instanceof Error ? e.message : "SMTP send failed",
      retriable: true,
    };
  }
}

/* ------------------------------------------------------------------ */
/* WhatsApp — Cloud API                                                */
/* ------------------------------------------------------------------ */

async function sendWhatsApp(to: string, body: string): Promise<SendOutcome> {
  const s = await getSettings();
  const token = s["api.whatsappToken"];
  // Cloud API addresses a message as /{phone-number-id}/messages. Someone who
  // pastes the full URL into the settings box used to end up with requests to
  // ".../messages/messages", so the base is built here and the setting is read
  // as the phone number id.
  const phoneNumberId = s["api.whatsappUrl"];

  if (!phoneNumberId || !token) {
    return {
      ok: false,
      configured: false,
      error: "WhatsApp API is not configured.",
    };
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId.replace(/^\/+|\/+$/g, "")}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        error: `WhatsApp API returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const parsed = JSON.parse(text) as { messages?: { id?: string }[] };
    return { ok: true, configured: true, providerId: parsed.messages?.[0]?.id };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      error: e instanceof Error ? e.message : "WhatsApp request failed",
      retriable: true,
    };
  }
}

/**
 * Telegram, for an alert that has to reach somebody at 2am.
 *
 * The only channel here with a real chance of being answered at that hour, and the
 * one an on-call engineer already has open. Token and chat id come from settings;
 * nothing is compiled in.
 */
async function sendTelegram(to: string, body: string): Promise<SendOutcome> {
  const s = await getSettings();
  const token = s["api.telegramToken"]?.trim();
  const defaultChat = s["api.telegramChatId"]?.trim();
  // An explicit `to` wins, so one alert can be addressed to a different chat.
  const chatId = (to?.trim() || defaultChat || "").replace(/^@/, "");
  if (!token || !chatId) {
    return { ok: false, configured: false, error: "Telegram is not configured." };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: body }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        error: `Telegram returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const parsed = JSON.parse(text) as { result?: { message_id?: number } };
    return { ok: true, configured: true, providerId: String(parsed.result?.message_id ?? "") };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      error: e instanceof Error ? e.message : "Telegram request failed",
      retriable: true,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/** Sends one message through the adapter for its channel. */
export async function dispatch(
  channel: string,
  to: string,
  subject: string | null,
  body: string,
): Promise<SendOutcome> {
  switch (channel) {
    case "SMS":
      return sendSms(to, body);
    case "Email":
      return sendEmail(to, subject ?? "", body);
    case "WhatsApp":
      return sendWhatsApp(to, body);
    case "Telegram":
      return sendTelegram(to, body);
    default:
      return {
        ok: false,
        configured: false,
        error: `Unknown channel "${channel}".`,
      };
  }
}

/**
 * Used by the "Test Connection" button in Settings → API. Reports whether the
 * channel is configured and, for SMTP, whether the relay actually answers.
 */
export async function testConnection(
  channel: string,
): Promise<{ ok: boolean; message: string }> {
  const s = await getSettings();

  if (channel === "Email") {
    const host = s["api.emailSmtpHost"];
    const user = s["api.emailSmtpUser"];
    const pass = s["api.emailSmtpPass"];
    if (!host || !user || !pass) {
      return {
        ok: false,
        message: "Set the SMTP host, username and password first.",
      };
    }
    try {
      const transport = nodemailer.createTransport({
        host,
        port: Number(s["api.emailSmtpPort"] ?? 587),
        secure: s["api.emailSmtpSecure"] === "true",
        auth: { user, pass },
        tls: { rejectUnauthorized: false },
      });
      await transport.verify();
      return {
        ok: true,
        message: `SMTP relay ${host} accepted the credentials.`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "SMTP verification failed",
      };
    }
  }

  if (channel === "SMS" || channel === "WhatsApp") {
    const url = channel === "SMS" ? s["api.smsUrl"] : s["api.whatsappUrl"];
    const key = channel === "SMS" ? s["api.smsApiKey"] : s["api.whatsappToken"];
    if (!url || !key) {
      return {
        ok: false,
        message: `Set the ${channel} API URL and key first.`,
      };
    }
    // A HEAD request is enough to prove the endpoint is reachable without
    // sending a message to a real customer.
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      return {
        ok: true,
        message: `${channel} endpoint answered ${res.status}. Send a test message to confirm delivery.`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Endpoint unreachable",
      };
    }
  }

  return { ok: false, message: `Unknown channel "${channel}".` };
}

/** Whether a channel has the credentials it needs to deliver. */
export async function isChannelConfigured(channel: string): Promise<boolean> {
  const s = await getSettings();
  if (channel === "SMS") return Boolean(s["api.smsUrl"] && s["api.smsApiKey"]);
  if (channel === "WhatsApp")
    return Boolean(s["api.whatsappUrl"] && s["api.whatsappToken"]);
  if (channel === "Email") {
    return Boolean(
      s["api.emailSmtpHost"] &&
      s["api.emailSmtpUser"] &&
      s["api.emailSmtpPass"],
    );
  }
  // Telegram is the one channel with a "who on call" answer that does not need a
  // phone number: the chat id is the recipient.
  if (channel === "Telegram") {
    return Boolean(s["api.telegramToken"]?.trim() && s["api.telegramChatId"]?.trim());
  }
  return false;
}

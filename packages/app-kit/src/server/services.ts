// Provider-agnostic side effects — SERVER ONLY.
//
// Apps code against the interfaces (EmailProvider / BlobStore / NotificationProvider);
// the AWS factories are the default impls (SES / S3 / SNS), lazy-loaded so a
// non-AWS deploy can swap them and apps that don't use them don't pull @aws-sdk.
// Ported from packages/core src/{ses,storage,sns}.mjs.

import crypto from "node:crypto";

// ---- interfaces ------------------------------------------------------------

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}
export interface EmailProvider {
  configured(): boolean;
  send(msg: EmailMessage): Promise<{ id?: string }>;
}

export interface PutBlobOptions {
  key?: string;
  prefix?: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  public?: boolean;
  cacheSeconds?: number;
}
export interface BlobStore {
  configured(): boolean;
  put(opts: PutBlobOptions): Promise<{ url: string; key: string }>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export interface SmsMessage {
  to: string;
  body: string;
}
export interface NotificationProvider {
  configured(): boolean;
  sendSms(msg: SmsMessage): Promise<{ id?: string }>;
}

// ---- pure upload helpers (no AWS) — handy in upload routes -----------------

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const FILE_TYPES: Record<string, string> = { ...IMAGE_TYPES, "application/pdf": "pdf" };

export const isAllowedImage = (ct: string) => Boolean(IMAGE_TYPES[String(ct || "").toLowerCase()]);
export const isAllowedFile = (ct: string) => Boolean(FILE_TYPES[String(ct || "").toLowerCase()]);
export const extFor = (ct: string, fallback = "bin") => FILE_TYPES[String(ct || "").toLowerCase()] || fallback;

/** Decode a `data:` URL into bytes + content type (for base64 image uploads). */
export function decodeDataUrl(dataUrl: string): { body: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/i.exec(String(dataUrl || ""));
  if (!m) return null;
  return { contentType: m[1]!.toLowerCase(), body: Buffer.from(m[2]!, "base64") };
}

// ---- lazy AWS loaders ------------------------------------------------------

async function loadAws<T>(pkg: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ pkg)) as T;
  } catch {
    throw new Error(`${pkg} is not installed — run \`pnpm add ${pkg}\` to use the AWS provider, or supply your own implementation.`);
  }
}

const awsRegion = (...envKeys: string[]) =>
  envKeys.map((k) => process.env[k]).find(Boolean) || "us-east-1";
const awsCreds = () => ({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
});
const hasCreds = () => Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

// ---- AWS SES email ---------------------------------------------------------

export function createAwsEmailProvider(): EmailProvider {
  const from = () => process.env.SES_FROM || process.env.EMAIL_FROM || "";
  let client: any = null;
  let mod: any = null;
  const get = async () => {
    if (!client) {
      mod = await loadAws<any>("@aws-sdk/client-ses");
      client = new mod.SESClient({ region: awsRegion("SES_REGION", "AWS_REGION"), credentials: awsCreds() });
    }
    return client;
  };
  return {
    configured: () => hasCreds() && Boolean(from()),
    async send(msg) {
      const c = await get();
      const to = Array.isArray(msg.to) ? msg.to : [msg.to];
      const out = await c.send(
        new mod.SendEmailCommand({
          Source: msg.from || from(),
          Destination: { ToAddresses: to },
          ...(msg.replyTo ? { ReplyToAddresses: [msg.replyTo] } : {}),
          Message: {
            Subject: { Data: msg.subject, Charset: "UTF-8" },
            Body: {
              ...(msg.html ? { Html: { Data: msg.html, Charset: "UTF-8" } } : {}),
              ...(msg.text ? { Text: { Data: msg.text, Charset: "UTF-8" } } : {}),
            },
          },
        }),
      );
      return { id: out?.MessageId };
    },
  };
}

// ---- AWS S3 blob store -----------------------------------------------------

export function createAwsBlobStore(): BlobStore {
  const bucket = () => process.env.S3_BUCKET || "";
  const region = () => awsRegion("S3_REGION", "AWS_REGION");
  const publicUrl = (key: string) => {
    const base = (process.env.S3_PUBLIC_BASE || "").replace(/\/+$/, "");
    return base ? `${base}/${key}` : `https://${bucket()}.s3.${region()}.amazonaws.com/${key}`;
  };
  let client: any = null;
  let mod: any = null;
  const get = async () => {
    if (!client) {
      mod = await loadAws<any>("@aws-sdk/client-s3");
      client = new mod.S3Client({ region: region(), credentials: awsCreds() });
    }
    return client;
  };
  return {
    configured: () => hasCreds() && Boolean(bucket()),
    publicUrl,
    async put(opts) {
      if (!opts.body) throw new Error("BlobStore.put: empty body.");
      const key =
        opts.key ||
        `${(opts.prefix || "uploads").replace(/\/+$/, "")}/${Date.now().toString(36)}-${crypto
          .randomBytes(6)
          .toString("hex")}.${extFor(opts.contentType)}`;
      const c = await get();
      await c.send(
        new mod.PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: opts.body,
          ContentType: opts.contentType || "application/octet-stream",
          CacheControl: `public, max-age=${opts.cacheSeconds ?? 31536000}`,
          ...(opts.public !== false ? { ACL: "public-read" } : {}),
        }),
      );
      return { url: publicUrl(key), key };
    },
    async delete(key) {
      const c = await get();
      await c.send(new mod.DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },
  };
}

// ---- AWS SNS sms -----------------------------------------------------------

export function createAwsNotificationProvider(): NotificationProvider {
  let client: any = null;
  let mod: any = null;
  const get = async () => {
    if (!client) {
      mod = await loadAws<any>("@aws-sdk/client-sns");
      client = new mod.SNSClient({ region: awsRegion("SNS_REGION", "AWS_REGION"), credentials: awsCreds() });
    }
    return client;
  };
  return {
    configured: () => hasCreds(),
    async sendSms(msg) {
      const c = await get();
      const out = await c.send(new mod.PublishCommand({ PhoneNumber: msg.to, Message: msg.body }));
      return { id: out?.MessageId };
    },
  };
}

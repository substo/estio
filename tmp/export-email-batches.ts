import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const BATCH_SIZE = 100;
const OUT_DIR = path.join(process.cwd(), "tmp", "email-batches-private");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVATE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "aol.com",
  "msn.com",
  "mail.ru",
  "yandex.ru",
  "walla.com",
  "wp.pl",
  "seznam.cz",
  "gmx.net",
  "gmx.de",
  "gmx.ch",
  "web.de",
  "freenet.de",
  "cytanet.com.cy",
  "talk21.com",
  "sky.com",
  "virginmedia.com",
  "tiscali.co.uk",
  "skynet.be",
  "passmail.net",
]);
const ROLE_LOCAL_PARTS = new Set([
  "admin",
  "billing",
  "contact",
  "enquiries",
  "hello",
  "info",
  "mail",
  "manager",
  "marketing",
  "message",
  "newsletter",
  "no-reply",
  "noreply",
  "notification",
  "notifications",
  "notify",
  "office",
  "realestate",
  "reception",
  "sales",
  "security",
  "service",
  "support",
  "team",
  "verify",
  "welcome",
]);

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value
    .replace(/&nbsp;/gi, "")
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

function isPrivateEmail(email: string): boolean {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return false;
  if (ROLE_LOCAL_PARTS.has(localPart)) return false;
  if (localPart.includes("noreply") || localPart.includes("no-reply")) return false;
  return PRIVATE_DOMAINS.has(domain);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function main() {
  const contacts = await prisma.contact.findMany({
    where: {
      email: {
        not: null,
      },
    },
    select: {
      email: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const seen = new Set<string>();
  const emails: string[] = [];
  let invalid = 0;
  let nonPrivate = 0;

  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!email) {
      invalid += 1;
      continue;
    }
    if (!isPrivateEmail(email)) {
      nonPrivate += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  const batches = chunk(emails, BATCH_SIZE);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const batchLines: string[] = [];

  for (const [index, batch] of batches.entries()) {
    const batchNumber = index + 1;
    const fileName = `batch-${String(batchNumber).padStart(3, "0")}.txt`;
    const content = batch.join("; ");
    await fs.writeFile(path.join(OUT_DIR, fileName), `${content}\n`, "utf8");
    batchLines.push(`Batch ${batchNumber} (${batch.length}): ${content}`);
  }

  await fs.writeFile(path.join(OUT_DIR, "all-batches.txt"), `${batchLines.join("\n\n")}\n`, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "all-emails-one-per-line.txt"), `${emails.join("\n")}\n`, "utf8");

  console.log(`Contacts with email values: ${contacts.length}`);
  console.log(`Valid unique private emails: ${emails.length}`);
  console.log(`Invalid email values skipped: ${invalid}`);
  console.log(`Non-private/subscription/company emails skipped: ${nonPrivate}`);
  console.log(`Batches of ${BATCH_SIZE}: ${batches.length}`);
  console.log(`Wrote files to: ${OUT_DIR}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

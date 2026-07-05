import * as z from "zod";
import { oraPromise } from "ora";
import * as p from "@inquirer/prompts";

process.on("uncaughtException", (error) => {
  if (error instanceof Error && error.name === "ExitPromptError") {
    return;
  }

  throw error;
});

const cloudflareApiUrl = "https://api.cloudflare.com/client/v4/";

const cloudflareErrorSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
});

const cloudflareEnvelopeSchema = <T extends z.ZodTypeAny>(result: T) =>
  z.object({
    success: z.boolean(),
    errors: z.array(cloudflareErrorSchema).default([]),
    messages: z.array(z.unknown()).default([]),
    result,
  });

function createCloudflareUrl(pathname: string) {
  return new URL(pathname.replace(/^\/+/, ""), cloudflareApiUrl);
}

function formatCloudflareErrors(errors: z.infer<typeof cloudflareErrorSchema>[]) {
  if (errors.length === 0) {
    return "Unknown Cloudflare API error";
  }

  return errors
    .map((error) =>
      [error.code, error.message].filter((value) => value !== undefined).join(": "),
    )
    .join("\n");
}

async function sendRequest<T extends z.ZodTypeAny>(
  apiToken: string,
  pathname: string,
  resultSchema: T,
  options: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
  } = {},
): Promise<z.infer<T>> {
  const response = await fetch(createCloudflareUrl(pathname), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = cloudflareEnvelopeSchema(resultSchema).parse(await response.json());

  if (!response.ok || !payload.success) {
    throw new Error(formatCloudflareErrors(payload.errors));
  }

  return payload.result;
}

function getZoneCandidates(domain: string) {
  const labels = domain.split(".");

  return labels
    .slice(0, -1)
    .map((_, index) => labels.slice(index).join("."));
}

async function findZoneId(apiToken: string, publicDomain: string) {
  const zoneSchema = z.object({
    id: z.string(),
    name: z.string(),
  });

  for (const candidate of getZoneCandidates(publicDomain)) {
    const searchParams = new URLSearchParams({ name: candidate });
    const zones = await sendRequest(
      apiToken,
      `/zones?${searchParams}`,
      z.array(zoneSchema),
    );

    const zone = zones.find((zone) => zone.name === candidate);

    if (zone) {
      return zone.id;
    }
  }

  throw new Error(`No Cloudflare zone found for ${publicDomain}`);
}

async function upsertDnsRecord(input: {
  apiToken: string;
  zoneId: string;
  name: string;
  serverIp: string;
}) {
  const dnsRecordSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal("A"),
    content: z.string(),
  });

  const searchParams = new URLSearchParams({
    type: "A",
    name: input.name,
  });

  const records = await sendRequest(
    input.apiToken,
    `/zones/${input.zoneId}/dns_records?${searchParams}`,
    z.array(dnsRecordSchema),
  );

  if (records.length > 1) {
    throw new Error(`Expected at most one A record for ${input.name}`);
  }

  const body = {
    type: "A",
    name: input.name,
    content: input.serverIp,
    ttl: 1,
    proxied: true,
    comment: "Managed by vps-bootstrap",
  };

  if (records.length === 0) {
    await sendRequest(input.apiToken, `/zones/${input.zoneId}/dns_records`, z.unknown(), {
      method: "POST",
      body,
    });

    return "created";
  }

  await sendRequest(
    input.apiToken,
    `/zones/${input.zoneId}/dns_records/${records[0].id}`,
    z.unknown(),
    {
      method: "PUT",
      body,
    },
  );

  return "updated";
}

const publicDomain = (
  await p.input({
    message: "Public domain",
    validate(value) {
      return (
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
          value.trim().toLowerCase(),
        ) || "Enter a valid public domain, like example.com"
      );
    },
  })
)
  .trim()
  .toLowerCase();

console.log("");

const serverIp = (
  await p.input({
    message: "Server IPv4",
    validate(value) {
      return (
        /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(
          value.trim(),
        ) || "Enter a valid IPv4 address"
      );
    },
  })
).trim();

console.log("");

const apiToken = await p.password({
  message: "Cloudflare API token",
  mask: "*",
  validate(value) {
    return value.trim().length > 0 || "This value is required";
  },
});

console.log("");

const zoneId = await oraPromise(
  findZoneId(apiToken, publicDomain),
  "Finding Cloudflare zone",
);

const result = await oraPromise(
  upsertDnsRecord({
    apiToken,
    zoneId,
    name: publicDomain,
    serverIp,
  }),
  "Upserting Cloudflare DNS record",
);

console.log("");
console.info(`Cloudflare DNS record ${result}:`);
console.info(`${publicDomain} -> ${serverIp} proxied`);

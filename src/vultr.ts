import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as z from "zod";
import * as p from "@inquirer/prompts";

async function sendRequest<T extends z.ZodTypeAny>(
  apiKey: string | null,
  pathname: string,
  responseSchema: T,
  body?: Record<string, string | number | boolean | null | undefined>,
) {
  const response = await fetch(new URL(pathname, "https://api.vultr.com"), {
    method: body ? "POST" : "GET",
    headers: {
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw await response.json();
  }

  return responseSchema.parse(await response.json());
}

const regionId = await p.select({
  message: "Select a Vultr region",
  choices: (
    await sendRequest(
      null,
      "/v2/regions",
      z.object({
        regions: z.array(
          z.object({
            id: z.string(),
            city: z.string(),
            country: z.string(),
          }),
        ),
      }),
    )
  ).regions.map((region) => ({
    name: `${region.city}, ${region.country} (${region.id})`,
    value: region.id,
  })),
});

const planId = await p.select({
  message: "Select a Vultr plan",
  choices: (
    await sendRequest(
      null,
      `/v2/regions/${regionId}/availability`,
      z.object({
        available_plans: z.array(z.string()),
      }),
    )
  ).available_plans,
});

const osId = await p.select({
  message: "Select a Vultr operating system",
  choices: (
    await sendRequest(
      null,
      "/v2/os",
      z.object({
        os: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            family: z.string(),
            arch: z.string(),
          }),
        ),
      }),
    )
  ).os
    .filter((os) => os.family === "ubuntu" || os.family === "debian")
    .toSorted((left, right) => right.name.localeCompare(left.name))
    .map((os) => ({
      name: os.name,
      value: os.id,
    })),
});

const publicDomain = await p.input({
  message: "Public domain for HTTPS",
  validate(value) {
    return (
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
        value.trim().toLowerCase(),
      ) || "Enter a valid public domain, like example.com"
    );
  },
});

const sshAuthorizedKeys = await p.input({
  message: "SSH authorized keys (comma-separated)",
  validate(value) {
    return (
      value
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean).length > 0 || "Enter at least one SSH authorized key"
    );
  },
});

let cloudConfig = await fs.readFile(
  path.join(import.meta.dirname, "cloud-config.yaml"),
  "utf8",
);
cloudConfig = cloudConfig.replace(/^# NOTE:\n(?:#[^\n]*(?:\n|$))+\n?/m, "");
cloudConfig = cloudConfig.replace(
  "${{ __SSH_AUTHORIZED_KEYS__ }}",
  JSON.stringify(
    sshAuthorizedKeys
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  ),
);
cloudConfig = cloudConfig.replace(
  "${{ __PUBLIC_DOMAIN__ }}",
  publicDomain.trim().toLowerCase(),
);

const apiKey = await p.password({
  message: "Vultr API key",
  mask: "*",
  validate(value) {
    return value.trim().length > 0 || "This value is required";
  },
});

const instance = await sendRequest(
  apiKey,
  "/v2/instances",
  z.object({
    instance: z.object({
      id: z.string(),
    }),
  }),
  {
    region: regionId,
    plan: planId,
    os_id: osId,
    user_data: Buffer.from(cloudConfig, "utf8").toString("base64"),
  },
);

console.info(
  `\nVultr instance created:\nhttps://console.vultr.com/subs/?id=${instance.instance.id}`,
);

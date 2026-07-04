import * as path from "node:path";
import * as fs from "node:fs";
import * as z from "zod";
import * as p from "@inquirer/prompts";

function getUbuntuLtsVersion(name: string) {
  const match = /^Ubuntu\s+(\d+)\.(\d+)\s+LTS\b/i.exec(name);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

function compareUbuntuLtsVersions(left: string, right: string) {
  const leftVersion = getUbuntuLtsVersion(left);
  const rightVersion = getUbuntuLtsVersion(right);

  if (!leftVersion && !rightVersion) {
    return left.localeCompare(right);
  }

  if (!leftVersion) {
    return 1;
  }

  if (!rightVersion) {
    return -1;
  }

  return (
    rightVersion.major - leftVersion.major ||
    rightVersion.minor - leftVersion.minor ||
    left.localeCompare(right)
  );
}

async function sendRequest<T extends z.ZodTypeAny>(
  apiKey: string,
  pathname: string,
  responseSchema: T,
  body?: Record<string, string | number | boolean | null | undefined>,
) {
  const response = await fetch(new URL(pathname, "https://api.vultr.com"), {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw await response.json();
  }

  return responseSchema.parse(await response.json());
}

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

const apiKey = await p.password({
  message: "Vultr API key",
  mask: "*",
  validate(value) {
    return value.trim().length > 0 || "This value is required";
  },
});

const regions = await sendRequest(
  apiKey,
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
);

const region = await p.select({
  message: "Select a Vultr region",
  choices: regions.regions.map((region) => ({
    name: `${region.city}, ${region.country} (${region.id})`,
    value: region.id,
  })),
  pageSize: 15,
});

const [availability, plans, operatingSystems] = await Promise.all([
  sendRequest(
    apiKey,
    `/v2/regions/${region}/availability`,
    z.object({
      available_plans: z.array(z.string()),
    }),
  ),
  sendRequest(
    apiKey,
    "/v2/plans",
    z.object({
      plans: z.array(
        z.object({
          id: z.string(),
          vcpu_count: z.number(),
          ram: z.number(),
          disk: z.number(),
          bandwidth: z.number(),
          monthly_cost: z.number(),
          type: z.string(),
          locations: z.array(z.string()),
        }),
      ),
    }),
  ),
  sendRequest(
    apiKey,
    "/v2/os?family=debian",
    z.object({
      os: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          arch: z.string(),
          family: z.string(),
        }),
      ),
    }),
  ),
]);

const debianOperatingSystems = operatingSystems.os
  .filter((operatingSystem) => operatingSystem.family === "debian")
  .sort(
    (left, right) =>
      compareUbuntuLtsVersions(left.name, right.name) || left.id - right.id,
  );

const defaultOperatingSystem = debianOperatingSystems.find((operatingSystem) =>
  getUbuntuLtsVersion(operatingSystem.name),
);

if (!defaultOperatingSystem) {
  throw new Error("Vultr did not return any Ubuntu LTS operating systems");
}

const operatingSystem = await p.select({
  message: "Select a Vultr operating system",
  choices: debianOperatingSystems.map((operatingSystem) => ({
    name: `${operatingSystem.name} (${operatingSystem.arch}, ${operatingSystem.id})`,
    value: operatingSystem.id,
  })),
  default: defaultOperatingSystem.id,
  pageSize: 15,
});

const availablePlanIds = new Set(availability.available_plans);

const availablePlans = plans.plans
  .filter(
    (plan) => availablePlanIds.has(plan.id) && plan.locations.includes(region),
  )
  .sort(
    (left, right) =>
      left.monthly_cost - right.monthly_cost ||
      left.vcpu_count - right.vcpu_count ||
      left.ram - right.ram ||
      left.id.localeCompare(right.id),
  );

const plan = await p.select({
  message: "Select a Vultr plan",
  choices: availablePlans.map((plan) => ({
    name: `${plan.id} - ${plan.vcpu_count} vCPU, ${plan.ram} MB RAM, ${plan.disk} GB disk, $${
      plan.monthly_cost
    }/mo`,
    value: plan.id,
  })),
  pageSize: 15,
});

let cloudConfig = fs.readFileSync(
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

const instance = await sendRequest(
  apiKey,
  "/v2/instances",
  z.object({
    instance: z.object({
      id: z.string(),
    }),
  }),
  {
    region,
    plan,
    os_id: operatingSystem,
    user_data: Buffer.from(cloudConfig, "utf8").toString("base64"),
  },
);

console.info(
  `\nVultr instance created:\nhttps://console.vultr.com/subs/?id=${instance.instance.id}`,
);

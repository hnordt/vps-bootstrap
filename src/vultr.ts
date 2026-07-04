import * as z from "zod";
import * as p from "@inquirer/prompts";

const OS = {
  id: 2760, // Ubuntu 22.04 LTS x64
  minRam: 1024, // MB
};

async function sendRequest<T extends z.ZodTypeAny>(
  apiKey: string,
  endpoint: string,
  schema: T,
  body?: Record<string, any>,
) {
  const response = await fetch("https://api.vultr.com" + endpoint, {
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

  return schema.parse(await response.json());
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

const [availability, plans] = await Promise.all([
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
]);

const availablePlanIds = new Set(availability.available_plans);

const availablePlans = plans.plans
  .filter(
    (plan) =>
      availablePlanIds.has(plan.id) &&
      plan.locations.includes(region) &&
      plan.ram >= OS.minRam,
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

const cloudConfig = `#cloud-config

ssh_pwauth: false
disable_root: true

package_update: true
package_upgrade: true

groups:
  - app

users:
  - name: deploy
    groups: [sudo]
    shell: /bin/bash
    lock_passwd: true
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      ${sshAuthorizedKeys
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
        .map((key) => `- ${key}`)
        .join("\n")}

  - name: app
    system: true
    groups: [app]
    shell: /usr/sbin/nologin
    lock_passwd: true
`;

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
    os_id: OS.id,
    user_data: Buffer.from(cloudConfig, "utf8").toString("base64"),
  },
);

console.info(
  `Vultr instance created: https://console.vultr.com/subs/?id=${instance.instance.id}`,
);

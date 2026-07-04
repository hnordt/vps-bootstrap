import { Command, InvalidArgumentError } from "commander";

type Options = {
  vultrApiKey: string;
  sshAuthorizedKeys: string;
  label?: string;
  region: string;
  plan: string;
  osId: number;
};

const parseInteger = (value: string) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`expected an integer, received "${value}"`);
  }

  return parsed;
};

const program = new Command()
  .name("vps-bootstrap")
  .description("Create a Vultr VPS with cloud-init bootstrap data.")
  .requiredOption("-k, --vultr-api-key <key>", "Vultr API key")
  .requiredOption(
    "-s, --ssh-authorized-keys <keys>",
    "SSH authorized keys, comma-separated",
  )
  .option("--label <label>", "VPS label")
  .option("--region <region>", "Vultr region", "sea")
  .option("--plan <plan>", "Vultr plan", "vc2-1c-1gb")
  .option("--os-id <id>", "Vultr OS ID", parseInteger, 2760)
  .parse();

const options = program.opts<Options>();
const vpsLabel = options.label ?? `VPS ${new Date().toISOString()}`;

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
      ${options.sshAuthorizedKeys
        .split(",")
        .map((key) => `- ${key}`)
        .join("\n")}

  - name: app
    system: true
    groups: [app]
    shell: /usr/sbin/nologin
    lock_passwd: true
`;

const response = await fetch(`https://api.vultr.com/v2/instances`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${options.vultrApiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    region: options.region,
    plan: options.plan,
    os_id: options.osId,
    user_data: Buffer.from(cloudConfig, "utf8").toString("base64"),
    label: vpsLabel,
  }),
});

const json = await response.json();

console.log(JSON.stringify(json, null, 2));

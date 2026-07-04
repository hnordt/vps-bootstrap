import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: stdin, output: stdout });

const vultrApiKey =
  process.env.VULTR_API_KEY || (await rl.question("Vultr API Key: "));

const sshAuthorizedKeys =
  process.env.SSH_AUTHORIZED_KEYS ||
  (await rl.question("SSH Authorized Keys (comma-separated): "));

const vpsLabel =
  (process.env.VPS_LABEL || (await rl.question("VPS Label: "))) ??
  `VPS ${new Date().toISOString()}`;

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
    Authorization: `Bearer ${vultrApiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    region: "sea", // @todo
    plan: "vc2-1c-1gb", // @todo
    os_id: 2760, // @todo
    user_data: Buffer.from(cloudConfig, "utf8").toString("base64"),
    label: vpsLabel,
  }),
});

const json = await response.json();

console.log("\n" + JSON.stringify(json, null, 2));

rl.close();

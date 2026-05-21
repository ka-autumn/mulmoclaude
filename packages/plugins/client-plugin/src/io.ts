import { Client, ClientSchema, Project, ProjectSchema } from "./types";

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

export function escapeYamlScalar(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ").trim();
  const needsQuoting = /[:#'"\\[\]{}>|`*&!%@?]/.test(oneLine) || /^\s|\s$/.test(oneLine) || /^(true|false|null|~|yes|no|on|off)$/i.test(oneLine);
  return needsQuoting ? JSON.stringify(oneLine) : oneLine;
}

export function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

// Custom lightweight YAML frontmatter parser
export function parseYaml(yamlText: string): any {
  const lines = yamlText.split(/\r?\n/);
  const root: any = {};

  let currentObjKey: string | null = null;
  let currentObj: any = null;
  let currentArray: any[] = [];
  let arrayItemObj: any = null;

  const savePending = () => {
    if (currentObjKey) {
      if (arrayItemObj) {
        currentArray.push(arrayItemObj);
        arrayItemObj = null;
      }
      if (currentArray.length > 0) {
        root[currentObjKey] = currentArray;
      } else if (currentObj) {
        root[currentObjKey] = currentObj;
      } else {
        // Empty-value key with no nested content (e.g. `expectedDeliverables: `)
        // is an empty string, not an empty array — matches what serialiseProject /
        // serialiseClient produce for empty string fields. Returning [] here makes
        // Zod reject the record and the row gets silently dropped from listings.
        root[currentObjKey] = "";
      }
      currentObjKey = null;
      currentObj = null;
      currentArray = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const kvMatch = line.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/);
    const itemMatch = line.match(/^(\s*)-\s*(.*)$/);

    if (kvMatch) {
      const [, spaces, key, valRaw] = kvMatch;
      const keyIndent = spaces.length;
      const value = unquote(valRaw);

      if (keyIndent === 0) {
        savePending();
        if (value !== "") {
          root[key] = value;
        } else {
          currentObjKey = key;
          currentObj = null;
          currentArray = [];
          arrayItemObj = null;
        }
      } else if (keyIndent > 0 && currentObjKey) {
        if (arrayItemObj) {
          arrayItemObj[key] = value;
        } else if (currentObj) {
          currentObj[key] = value;
        } else {
          currentObj = { [key]: value };
        }
      }
    } else if (itemMatch) {
      const [, , valRaw] = itemMatch;
      const value = unquote(valRaw);

      if (currentObjKey) {
        const inlineKv = valRaw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (inlineKv) {
          if (arrayItemObj) {
            currentArray.push(arrayItemObj);
          }
          arrayItemObj = { [inlineKv[1]]: unquote(inlineKv[2]) };
        } else if (value !== "") {
          currentArray.push(value);
        } else {
          if (arrayItemObj) {
            currentArray.push(arrayItemObj);
          }
          arrayItemObj = {};
        }
      }
    }
  }

  savePending();
  return root;
}

export function parseFrontmatter(raw: string): { meta: any; body: string } | null {
  if (!FRONTMATTER_OPEN.test(raw)) return null;
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) return null;
  const yamlText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  return { meta: parseYaml(yamlText), body };
}

// Client Serializer and Deserializer
export function serialiseClient(client: Client): string {
  const lines = ["---", `id: ${escapeYamlScalar(client.id)}`, `name: ${escapeYamlScalar(client.name)}`, `status: ${client.status}`];

  if (client.contacts && client.contacts.length > 0) {
    lines.push("contacts:");
    for (const contact of client.contacts) {
      lines.push(`  - name: ${escapeYamlScalar(contact.name)}`);
      lines.push(`    email: ${escapeYamlScalar(contact.email)}`);
      if (contact.role) {
        lines.push(`    role: ${escapeYamlScalar(contact.role)}`);
      }
    }
  }

  if (client.rate) {
    lines.push("rate:");
    lines.push(`  amount: ${client.rate.amount}`);
    lines.push(`  currency: ${escapeYamlScalar(client.rate.currency)}`);
    lines.push(`  unit: ${escapeYamlScalar(client.rate.unit)}`);
  }

  lines.push(`paymentTerms: ${escapeYamlScalar(client.paymentTerms)}`);

  if (client.tags && client.tags.length > 0) {
    lines.push("tags:");
    for (const tag of client.tags) {
      lines.push(`  - ${escapeYamlScalar(tag)}`);
    }
  }

  lines.push(`firstEngagement: ${escapeYamlScalar(client.firstEngagement)}`);
  lines.push("---", "", client.notes.trimEnd(), "");
  return lines.join("\n");
}

export function deserialiseClient(raw: string): Client | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;

  const meta = parsed.meta;

  // Normalise rates
  let rate = { amount: 0, currency: "USD", unit: "hour" };
  if (meta.rate) {
    rate = {
      amount: typeof meta.rate.amount === "string" ? parseFloat(meta.rate.amount) : meta.rate.amount || 0,
      currency: meta.rate.currency || "USD",
      unit: meta.rate.unit || "hour",
    };
  }

  // Normalise contacts
  const contacts = Array.isArray(meta.contacts)
    ? meta.contacts.map((c: any) => ({
        name: c?.name || "",
        email: c?.email || "",
        role: c?.role || "",
      }))
    : [];

  // Normalise tags
  const tags = Array.isArray(meta.tags) ? meta.tags : [];

  const rawClient = {
    id: meta.id || "",
    name: meta.name || "",
    status: meta.status || "active",
    contacts,
    rate,
    paymentTerms: meta.paymentTerms || "net-30",
    tags,
    firstEngagement: meta.firstEngagement || new Date().toISOString().split("T")[0],
    notes: parsed.body.trim(),
  };

  const validated = ClientSchema.safeParse(rawClient);
  if (!validated.success) {
    return null;
  }
  return validated.data;
}

// Project Serializer and Deserializer
export function serialiseProject(project: Project): string {
  const lines = [
    "---",
    `id: ${escapeYamlScalar(project.id)}`,
    `clientId: ${escapeYamlScalar(project.clientId)}`,
    `name: ${escapeYamlScalar(project.name)}`,
    `status: ${project.status}`,
    `feeModel: ${project.feeModel}`,
  ];

  if (project.rate) {
    lines.push("rate:");
    lines.push(`  amount: ${project.rate.amount}`);
    lines.push(`  currency: ${escapeYamlScalar(project.rate.currency)}`);
    lines.push(`  unit: ${escapeYamlScalar(project.rate.unit)}`);
  }

  lines.push(`startDate: ${escapeYamlScalar(project.startDate)}`);
  lines.push(`expectedDeliverables: ${escapeYamlScalar(project.expectedDeliverables)}`);
  lines.push("---", "", project.notes.trimEnd(), "");
  return lines.join("\n");
}

export function deserialiseProject(raw: string): Project | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;

  const meta = parsed.meta;

  // Normalise rate
  let rate = undefined;
  if (meta.rate) {
    rate = {
      amount: typeof meta.rate.amount === "string" ? parseFloat(meta.rate.amount) : meta.rate.amount || 0,
      currency: meta.rate.currency || "USD",
      unit: meta.rate.unit || "hour",
    };
  }

  const rawProject = {
    id: meta.id || "",
    clientId: meta.clientId || "",
    name: meta.name || "",
    status: meta.status || "active",
    feeModel: meta.feeModel || "hour",
    rate,
    startDate: meta.startDate || new Date().toISOString().split("T")[0],
    expectedDeliverables: meta.expectedDeliverables || "",
    notes: parsed.body.trim(),
  };

  const validated = ProjectSchema.safeParse(rawProject);
  if (!validated.success) {
    return null;
  }
  return validated.data;
}

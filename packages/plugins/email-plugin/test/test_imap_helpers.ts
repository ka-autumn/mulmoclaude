// Regression tests for the per-address rendering helper. Codex
// review flagged that the previous version joined `to`/`cc` into
// a comma-separated string and then split it back — display names
// containing commas like `"Doe, John" <john@example.com>` would
// be sliced apart. `addressList` now builds arrays straight from
// the structured `AddressObject.value[]` so a comma in the name
// stays inside its own entry.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressObject } from "mailparser";
import { addressList } from "../src/imap";

function ao(value: Array<{ name?: string; address?: string }>): AddressObject {
  // mailparser's AddressObject also carries `text` + `html` but
  // only `.value` is read by `addressList`.
  return { value, text: "", html: "" } as unknown as AddressObject;
}

describe("addressList", () => {
  it("returns empty array for undefined input", () => {
    assert.deepEqual(addressList(undefined), []);
  });

  it("preserves display names with commas as a single entry", () => {
    const list = addressList(ao([{ name: "Doe, John", address: "john@example.com" }, { address: "alice@example.com" }]));
    assert.deepEqual(list, ["Doe, John <john@example.com>", "alice@example.com"]);
  });

  it("formats name + address as `Name <addr>`", () => {
    const list = addressList(ao([{ name: "Alice Smith", address: "a@x.com" }]));
    assert.deepEqual(list, ["Alice Smith <a@x.com>"]);
  });

  it("falls back to bare address when no display name", () => {
    const list = addressList(ao([{ address: "noreply@example.com" }]));
    assert.deepEqual(list, ["noreply@example.com"]);
  });

  it("flattens AddressObject[] input (multi-block To)", () => {
    const list = addressList([ao([{ address: "a@x.com" }]), ao([{ address: "b@x.com" }])]);
    assert.deepEqual(list, ["a@x.com", "b@x.com"]);
  });

  it("drops entries with neither name nor address", () => {
    const list = addressList(ao([{ address: "a@x.com" }, {}, { name: "Bob" }]));
    assert.deepEqual(list, ["a@x.com", "Bob <>"]);
  });
});

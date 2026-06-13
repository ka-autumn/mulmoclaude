// Validation tests for custom-view (`views[]`) schema registrations (see
// plans/feat-collections-custom-views.md). Drives the exported Zod schema
// directly — the rules are pure shape checks, no filesystem needed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CollectionSchemaZ } from "../../../server/workspace/collections/discovery.js";

const base = {
  title: "Plans",
  icon: "calendar_month",
  dataPath: "data/plans/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
  },
};

function withViews(views: unknown) {
  return CollectionSchemaZ.safeParse({ ...base, views });
}

describe("collection schema — custom views validation", () => {
  it("accepts a schema with no views (back-compat)", () => {
    assert.equal(CollectionSchemaZ.safeParse(base).success, true);
  });

  it("accepts read-only and read/write views with valid files", () => {
    const result = withViews([
      { id: "year", label: "Year", icon: "grid_view", file: "views/year.html", capabilities: ["read"] },
      { id: "planner", label: "Planner", file: "views/planner.html", capabilities: ["read", "write"] },
    ]);
    assert.equal(result.success, true);
  });

  it("accepts a view with no capabilities (defaults applied downstream)", () => {
    assert.equal(withViews([{ id: "year", label: "Year", file: "views/year.html" }]).success, true);
  });

  it("rejects a file outside views/ or without .html", () => {
    assert.equal(withViews([{ id: "a", label: "A", file: "templates/a.html" }]).success, false);
    assert.equal(withViews([{ id: "b", label: "B", file: "views/b.txt" }]).success, false);
    assert.equal(withViews([{ id: "c", label: "C", file: "views/../secret.html" }]).success, false);
  });

  it("rejects duplicate view ids", () => {
    const result = withViews([
      { id: "dup", label: "One", file: "views/one.html" },
      { id: "dup", label: "Two", file: "views/two.html" },
    ]);
    assert.equal(result.success, false);
  });

  it("rejects an id that is not a valid slug", () => {
    assert.equal(withViews([{ id: "bad/id", label: "X", file: "views/x.html" }]).success, false);
  });

  it("rejects an unknown capability value", () => {
    assert.equal(withViews([{ id: "a", label: "A", file: "views/a.html", capabilities: ["delete"] }]).success, false);
  });
});

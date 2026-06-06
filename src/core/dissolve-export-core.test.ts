import { describe, it, expect } from "vitest";
import { buildLookupCsv, attributionText } from "./dissolve-export-core";

// ---------------------------------------------------------------------------
// buildLookupCsv
// ---------------------------------------------------------------------------

describe("buildLookupCsv", () => {
  it("emits the correct header", () => {
    const csv = buildLookupCsv({}, "LSOA21CD", 2021);
    expect(csv.split("\n")[0]).toBe("LSOA21CD,custom_label,vintage_year");
  });

  it("produces one data row per mapping entry", () => {
    const csv = buildLookupCsv(
      { E01000001: "North", E01000002: "South" },
      "LSOA21CD",
      2021
    );
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it("encodes code, label, and vintage year correctly", () => {
    const csv = buildLookupCsv({ E01000001: "North" }, "LSOA21CD", 2021);
    expect(csv).toContain("E01000001,North,2021");
  });

  it("quotes labels that contain commas", () => {
    const csv = buildLookupCsv({ E01000001: "North, West" }, "LSOA21CD", 2021);
    expect(csv).toContain('"North, West"');
  });

  it("quotes labels that contain double-quotes and doubles them", () => {
    const csv = buildLookupCsv({ E01000001: 'Say "hello"' }, "LSOA21CD", 2021);
    expect(csv).toContain('"Say ""hello"""');
  });

  it("produces an empty file (header only) when mapping is empty", () => {
    const csv = buildLookupCsv({}, "OA21CD", 2021);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("OA21CD,custom_label,vintage_year");
  });

  it("ends with a newline", () => {
    const csv = buildLookupCsv({ E01000001: "A" }, "LSOA21CD", 2021);
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("respects the codeColumnName argument", () => {
    const csv = buildLookupCsv({ S00000001: "Scotland" }, "DZ11CD", 2011);
    expect(csv.split("\n")[0]).toBe("DZ11CD,custom_label,vintage_year");
  });
});

// ---------------------------------------------------------------------------
// attributionText
// ---------------------------------------------------------------------------

describe("attributionText", () => {
  it("includes the ONS OGL attribution line", () => {
    const text = attributionText(2021);
    expect(text).toContain("Office for National Statistics");
    expect(text).toContain("Open Government Licence");
  });

  it("includes the OS Crown copyright line", () => {
    const text = attributionText(2021);
    expect(text).toContain("Crown copyright");
  });

  it("embeds the vintage year in the OS copyright line", () => {
    const text = attributionText(2021);
    // The OS copyright line references the year
    expect(text).toContain("2021");
  });

  it("mentions the vintage year in the provenance note", () => {
    const text = attributionText(2019);
    expect(text).toContain("2019");
  });
});

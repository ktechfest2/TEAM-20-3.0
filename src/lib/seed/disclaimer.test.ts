import { describe, expect, it } from "vitest";
import { describeRecords, HISTORICAL_DISCLAIMER } from "./disclaimer";
import { ELECTIONS, HISTORICAL_UNITS, SYNTHETIC_DISCLAIMER, SYNTHETIC_UNITS, searchPollingUnits } from "./registry";

describe("describeRecords: registry responses are labelled truthfully", () => {
  it("sample-only results are synthetic with the fictional disclaimer", () => {
    expect(describeRecords(SYNTHETIC_UNITS)).toEqual({ synthetic: true, disclaimer: SYNTHETIC_DISCLAIMER });
  });
  it("real 2023 units are never labelled synthetic or fictional", () => {
    const r = describeRecords(searchPollingUnits("37-01-01-001"));
    expect(r.synthetic).toBe(false);
    expect(r.disclaimer).toBe(HISTORICAL_DISCLAIMER);
    expect(r.disclaimer).not.toMatch(/fictional/i);
  });
  it("mixed results name both kinds of data", () => {
    const r = describeRecords([...SYNTHETIC_UNITS, ...HISTORICAL_UNITS]);
    expect(r.synthetic).toBe(false);
    expect(r.disclaimer).toContain(SYNTHETIC_DISCLAIMER);
    expect(r.disclaimer).toContain(HISTORICAL_DISCLAIMER);
    expect(describeRecords(ELECTIONS).synthetic).toBe(false);
  });
  it("empty results claim nothing", () => {
    expect(describeRecords([])).toEqual({ synthetic: false, disclaimer: "No records" });
  });
});

import { describe, expect, it } from "vitest";

import {
  customerContactMatchKeys,
  InvalidCustomerContactError,
  matchingCustomerContactFields,
  normalizeCustomerContact,
} from "../src/customer";

describe("customer contact normalization", () => {
  it("normalizes exact email and phone comparison candidates", () => {
    const contact = normalizeCustomerContact({
      email: " Ada@Example.com ",
      phone: " +49 (30) 123-45 ",
    });

    expect(contact).toEqual({
      email: "ada@example.com",
      phone: "+493012345",
    });
    expect(customerContactMatchKeys(contact)).toEqual([
      "EMAIL:ada@example.com",
      "PHONE:+493012345",
    ]);
  });

  it("does not invent a telephone-country conversion or accept a blank contact", () => {
    expect(
      normalizeCustomerContact({ email: null, phone: "0049 30 12345" }),
    ).toEqual({ email: null, phone: "00493012345" });
    expect(() => normalizeCustomerContact({ email: " ", phone: " " })).toThrow(
      InvalidCustomerContactError,
    );
  });

  it("labels exact contact fields for staff review without merging profiles", () => {
    expect(
      matchingCustomerContactFields(
        { email: "ada@example.com", phone: "+4912345678" },
        { email: "ada@example.com", phone: "+4930123456" },
      ),
    ).toEqual(["email"]);
    expect(
      matchingCustomerContactFields(
        { email: "ada@example.com", phone: "+4912345678" },
        { email: null, phone: "+4912345678" },
      ),
    ).toEqual(["phone"]);
  });
});

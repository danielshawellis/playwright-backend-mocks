import { test, expect } from "../harness.js";
import { headerValue } from "../helpers.js";

test.describe("passthrough", () => {
  test("reaches the real upstream when no route matches", async ({ trigger }) => {
    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    expect(headerValue(result.headers, "x-upstream")).toBe("real");
  });

  test("reaches upstream for POST when unmatched", async ({ trigger }) => {
    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 11 }),
    });
    expect(result.status).toBe(201);
    expect(result.data).toEqual({
      id: "ch_real",
      amount: 11,
      status: "succeeded",
    });
  });
});

/**
 * Dual-mode plumbing smokes — no route mocks.
 *
 * Proves the shared downstream can reach upstream over HTTP and WebSocket in
 * both PARITY_MODE=browser (page) and PARITY_MODE=node (control-plane WS).
 */
import { test, expect, WS_UPSTREAM, parityMode } from "../harness.js";

test.describe(`passthrough smoke (${parityMode})`, () => {
  test("downstream HTTP fetch reaches upstream without mocks", async ({
    trigger,
  }) => {
    const result = await trigger("/users");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("downstream WebSocket reaches upstream echo without mocks", async ({
    openDownstreamSocket,
  }) => {
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("ping-smoke");
    const message = await socket.waitForMessage();
    expect(message.encoding).toBe("utf8");
    expect(message.data).toBe("ping-smoke");
    await socket.close(1000, "done");
  });
});

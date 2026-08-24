/**
 * Library E2E: real Node agent + proxy + local HTTP/1.1 upstream that varies
 * Content-Encoding × framing the way production CDNs do.
 *
 * Guards the class of bugs where Undici auto-decompresses but leaves wire
 * headers (e.g. Transfer-Encoding: chunked); replaying Content-Length + chunked
 * through MSW respondWith fails with UND_ERR_SOCKET.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { startBackendMocks } from "@playwright-backend-mocks/node";
import { assertWireResponseCoherent, TestSocket, withProxy } from "../helpers.js";
import {
  startWireUpstream,
  type WireBodyType,
  type WireEncoding,
  type WireFraming,
  type WireUpstream,
} from "../wire-upstream.js";

const ENCODINGS: WireEncoding[] = ["identity", "gzip", "deflate", "br"];
const FRAMINGS: WireFraming[] = ["length", "chunked"];

const MATRIX: Array<{ enc: WireEncoding; frame: WireFraming; type: WireBodyType }> =
  ENCODINGS.flatMap((enc) =>
    FRAMINGS.map((frame) => ({ enc, frame, type: "json" as const })),
  );

const EXTRA_CASES: Array<{
  enc: WireEncoding;
  frame: WireFraming;
  type: WireBodyType;
  label: string;
}> = [
  {
    enc: "br",
    frame: "chunked",
    type: "html",
    label: "br+chunked html (CDN-like)",
  },
  {
    enc: "gzip",
    frame: "chunked",
    type: "bin",
    label: "gzip+chunked binary",
  },
  {
    enc: "identity",
    frame: "length",
    type: "empty",
    label: "empty body with content-length",
  },
];

async function withAgentAndWire(
  run: (ctx: { wire: WireUpstream; proxyUrl: string; clientId: string }) => Promise<void>,
): Promise<void> {
  await withProxy({}, async (proxy) => {
    const clientId = `wire-${randomUUID().slice(0, 8)}`;
    const agent = await startBackendMocks({
      proxyUrl: proxy.url,
      clientId,
    });
    const wire = await startWireUpstream();
    try {
      await run({ wire, proxyUrl: proxy.url, clientId });
    } finally {
      await wire.close();
      await agent.stop();
    }
  });
}

test.describe("wire passthrough (encoding × framing)", () => {
  for (const cell of MATRIX) {
    test(`passthrough ${cell.enc}+${cell.frame} json`, async () => {
      await withAgentAndWire(async ({ wire }) => {
        const url = wire.wireUrl(cell);
        const response = await fetch(url, {
          headers: { "accept-encoding": "br, gzip, deflate" },
        });
        await assertWireResponseCoherent(response, cell.type);
      });
    });
  }

  for (const cell of EXTRA_CASES) {
    test(`passthrough ${cell.label}`, async () => {
      await withAgentAndWire(async ({ wire }) => {
        const url = wire.wireUrl(cell);
        const response = await fetch(url, {
          headers: { "accept-encoding": "br, gzip, deflate" },
        });
        await assertWireResponseCoherent(response, cell.type);
      });
    });
  }
});

/**
 * continue() uses the same settleWithUpstream path as unmatched passthrough.
 * Drive a Playwright-role TestSocket that claims and continues without overrides.
 */
const CONTINUE_CASES: Array<{
  enc: WireEncoding;
  frame: WireFraming;
  type: WireBodyType;
}> = [
  { enc: "br", frame: "chunked", type: "json" },
  { enc: "gzip", frame: "chunked", type: "json" },
  { enc: "deflate", frame: "chunked", type: "json" },
  { enc: "br", frame: "length", type: "json" },
  { enc: "br", frame: "chunked", type: "html" },
];

test.describe("wire continue (encoding × framing)", () => {
  for (const cell of CONTINUE_CASES) {
    test(`continue ${cell.enc}+${cell.frame} ${cell.type}`, async () => {
      await withProxy({}, async (proxy) => {
        const playwright = await TestSocket.connect(proxy.url);
        expect(
          (
            await playwright.hello({
              role: "playwright",
              workerId: "wire-continue-worker",
            })
          ).type,
        ).toBe("hello:ok");

        const wire = await startWireUpstream();
        const testId = randomUUID();
        const routeId = randomUUID();
        playwright.send({
          type: "test:register",
          testId,
          title: `wire continue ${cell.enc}+${cell.frame}`,
          file: "wire-passthrough.spec.ts",
          workerId: "wire-continue-worker",
        });
        // Exact host:port so glob matching does not depend on port wildcards.
        playwright.send({
          type: "route:register",
          routeId,
          testId,
          matcher: { urlGlob: `${wire.url}/wire**` },
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        const clientId = `wire-continue-${randomUUID().slice(0, 8)}`;
        const agent = await startBackendMocks({
          proxyUrl: proxy.url,
          clientId,
        });

        try {
          const url = wire.wireUrl(cell);
          const fetchPromise = fetch(url, {
            headers: { "accept-encoding": "br, gzip, deflate" },
          });

          const matched = await playwright.waitForType("request:matched", 5_000);
          playwright.send({
            type: "handler:result",
            requestId: matched.requestId,
            result: { action: "continue" },
          });

          const response = await fetchPromise;
          await assertWireResponseCoherent(response, cell.type);
        } finally {
          await agent.stop();
          await wire.close();
          playwright.close();
        }
      });
    });
  }
});

import { test, expect } from "@playwright-backend-mocks/playwright";

test("shows declined payment messaging", async ({ page, backendMocks }) => {
  await backendMocks.route(
    "https://payments.example.test/charges",
    async (route, request) => {
      expect(request.method()).toBe("POST");

      await route.fulfill({
        status: 402,
        json: { error: "card_declined" },
      });
    },
  );

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(page.getByText("Your card was declined")).toBeVisible();
});

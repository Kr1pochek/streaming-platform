import { expect, test } from "@playwright/test";
import { expectHomeLoaded } from "./helpers/app.js";

test("vibe tag on the home page opens search with a prefilled query", async ({ page }) => {
  await expectHomeLoaded(page);

  const firstVibeTag = page.getByTestId("home-vibe-tag").first();
  await expect(firstVibeTag).toBeVisible();

  const vibeText = ((await firstVibeTag.textContent()) ?? "").trim();
  expect(vibeText).not.toBe("");

  await firstVibeTag.click();

  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByTestId("search-input")).toHaveValue(vibeText);
});

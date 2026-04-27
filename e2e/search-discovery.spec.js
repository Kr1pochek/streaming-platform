import { expect, test } from "@playwright/test";
import { getPlayerTitle, resolveCatalogEntities, searchTokenFromTitle } from "./helpers/app.js";

test("search finds a live catalog track and starts playback", async ({ page, request }) => {
  const { track } = await resolveCatalogEntities(request);
  const query = searchTokenFromTitle(track.title);

  await page.goto("/search");
  await page.getByTestId("search-input").fill(query);

  const trackResultsSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Треки" }) })
    .first();
  await expect(trackResultsSection).toBeVisible();

  const trackResultButton = trackResultsSection.locator("button").filter({ hasText: track.title }).first();
  await expect(trackResultButton).toBeVisible();

  await trackResultButton.click();
  await expect(getPlayerTitle(page)).toHaveText(track.title);
  await expect(page.getByTestId("player-play-toggle")).toHaveAttribute("aria-label", "Пауза");
});

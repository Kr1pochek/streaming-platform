import { expect, test } from "@playwright/test";
import { expectHomeLoaded, getPlayerTitle, startWave } from "./helpers/app.js";

test("liked page reflects tracks added to favorites from the player", async ({ page }) => {
  await expectHomeLoaded(page);

  const playerTitle = await startWave(page);
  const currentTitle = ((await playerTitle.textContent()) ?? "").trim();

  const favoriteButton = page.getByTestId("player-footer").getByRole("button", { name: /избран/i });
  await favoriteButton.click();
  await expect(favoriteButton).toHaveAttribute("aria-pressed", "true");

  await page.goto("/liked");
  await expect(page.getByRole("heading", { name: "Мне нравится" })).toBeVisible();

  const playLikedTracksButton = page.getByRole("button", { name: "Слушать с начала" });
  await expect(playLikedTracksButton).toBeVisible();

  await playLikedTracksButton.click();
  await expect(getPlayerTitle(page)).toHaveText(currentTitle);
});

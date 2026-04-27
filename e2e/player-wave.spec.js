import { expect, test } from "@playwright/test";
import { expectHomeLoaded, startWave } from "./helpers/app.js";

test("home wave starts playback and fills the queue", async ({ page }) => {
  await expectHomeLoaded(page);

  await startWave(page);

  await page.getByTestId("player-queue-toggle").click();

  const queuePanel = page.getByTestId("player-queue-panel");
  await expect(queuePanel).toBeVisible();
  await expect.poll(async () => queuePanel.locator("li").count()).toBeGreaterThan(0);
});

test("player next and previous buttons switch tracks inside the generated wave queue", async ({ page }) => {
  await expectHomeLoaded(page);

  const playerTitle = await startWave(page);
  const initialTitle = ((await playerTitle.textContent()) ?? "").trim();

  await page.getByTestId("player-queue-toggle").click();
  const queuePanel = page.getByTestId("player-queue-panel");
  await expect.poll(async () => queuePanel.locator("li").count()).toBeGreaterThan(1);

  await page.getByTestId("player-next-button").click();
  await expect
    .poll(async () => ((await playerTitle.textContent()) ?? "").trim())
    .not.toBe(initialTitle);

  await page.getByTestId("player-prev-button").click();
  await expect(playerTitle).toHaveText(initialTitle);
});

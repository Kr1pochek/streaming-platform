import { expect, test } from "@playwright/test";
import { EMPTY_PLAYER_TITLE, getPlayerTitle, resolveCatalogEntities } from "./helpers/app.js";

test("live track, artist, release and playlist pages render and stay playable", async ({ page, request }) => {
  const { artist, playlist, release, track } = await resolveCatalogEntities(request);

  await page.goto(`/track/${track.id}`);
  await expect(page.getByRole("heading", { name: track.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Похожие треки" })).toBeVisible();
  await page.locator("header").getByRole("button", { name: /^Слушать$/ }).first().click();
  await expect(getPlayerTitle(page)).toHaveText(track.title);

  await page.goto(`/artist/${artist.id}`);
  await expect(page.getByRole("heading", { name: artist.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Популярные треки" })).toBeVisible();

  await page.goto(`/release/${release.id}`);
  await expect(page.getByRole("heading", { name: release.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Треки релиза" })).toBeVisible();
  await page.locator("header").getByRole("button", { name: /^Слушать$/ }).first().click();
  await expect(getPlayerTitle(page)).not.toHaveText(EMPTY_PLAYER_TITLE);

  await page.goto(`/playlist/${playlist.id}`);
  await expect(page.getByRole("heading", { name: playlist.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Треки" })).toBeVisible();
  await page.locator("header").getByRole("button", { name: /^Слушать$/ }).first().click();
  await expect(getPlayerTitle(page)).not.toHaveText(EMPTY_PLAYER_TITLE);
});

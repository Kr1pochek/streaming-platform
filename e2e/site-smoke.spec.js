import { expect, test } from "@playwright/test";
import { expectHomeLoaded } from "./helpers/app.js";

test("guest smoke check covers core routes and fallback states", async ({ page }) => {
  await expectHomeLoaded(page);

  await page.getByRole("link", { name: "Поиск" }).first().click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByTestId("search-input")).toBeVisible();

  await page.getByRole("link", { name: "Моя музыка" }).first().click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { name: "Моя музыка" })).toBeVisible();

  await page.getByRole("button", { name: "Создать плейлист" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();

  await page.goto("/liked");
  await expect(page.getByRole("heading", { name: "Мне нравится" })).toBeVisible();
  await expect(page.getByText("Пока нет лайков")).toBeVisible();

  await page.goto("/missing-route");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByText("Страница не найдена. Проверь адрес или вернись на главную.")).toBeVisible();
});

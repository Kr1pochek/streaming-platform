import { expect, test } from "@playwright/test";

test("profile upload form keeps helper copy readable", async ({ page, request }) => {
  const username = `profile${Date.now()}${test.info().retry}`;
  const registerResponse = await request.post("http://127.0.0.1:4000/api/auth/register", {
    data: {
      username,
      password: "pass12345",
      displayName: "Profile Test",
    },
  });

  expect(registerResponse.ok()).toBeTruthy();
  const payload = await registerResponse.json();
  expect(payload.token).toBeTruthy();

  await page.goto("/");
  await page.evaluate((token) => window.localStorage.setItem("music.auth.token.v1", token), payload.token);
  await page.goto("/profile");

  await expect(page.getByText("@PROFILE")).toBeVisible();
  await page.getByRole("button", { name: "Загрузить трек" }).click();

  await expect(
    page.getByText("Можно ввести свой жанр вручную или быстро выбрать один из ленты ниже.")
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("РњРѕ");
});

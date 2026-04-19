import { lazy } from "react";

const RETRY_STORAGE_PREFIX = "music.lazy-retry.";

export function isRecoverableLazyImportError(error) {
  const message =
    typeof error === "string"
      ? error
      : typeof error?.message === "string"
        ? error.message
        : "";
  const normalizedMessage = message.toLowerCase();

  if (!normalizedMessage) {
    return false;
  }

  return [
    "chunkloaderror",
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
    "failed to load module script",
    "loading css chunk",
  ].some((pattern) => normalizedMessage.includes(pattern));
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function hasReloadAttempt(storageKey) {
  if (!canUseSessionStorage()) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function markReloadAttempt(storageKey) {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // noop
  }
}

function clearReloadAttempt(storageKey) {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // noop
  }
}

export function lazyWithRecovery(loader, routeKey) {
  const normalizedRouteKey = String(routeKey ?? "route").trim() || "route";
  const storageKey = `${RETRY_STORAGE_PREFIX}${normalizedRouteKey}`;

  return lazy(async () => {
    try {
      const module = await loader();
      clearReloadAttempt(storageKey);
      return module;
    } catch (error) {
      if (
        typeof window !== "undefined" &&
        isRecoverableLazyImportError(error) &&
        !hasReloadAttempt(storageKey)
      ) {
        markReloadAttempt(storageKey);
        window.location.reload();
        return new Promise(() => {});
      }

      throw error;
    }
  });
}

import { AsyncLocalStorage } from "node:async_hooks";

const trackingUserStorage = new AsyncLocalStorage();

export function runWithTrackingUser(userId, fn) {
  const normalizedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
  return trackingUserStorage.run({ userId: normalizedUserId }, fn);
}

export function getCurrentTrackingUserId() {
  return trackingUserStorage.getStore()?.userId ?? null;
}

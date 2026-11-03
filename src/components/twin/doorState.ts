"use client";

/**
 * Door animation source. The twin sets a provider that answers "is this door open right now"
 * from the simulation (or from the replay frame being scrubbed); the editor preview leaves
 * the default, which shows every door open as before.
 */
let provider: (doorId: string) => boolean = () => true;

export function setDoorStateProvider(fn: ((doorId: string) => boolean) | null) {
  provider = fn ?? (() => true);
}

export function doorIsOpen(doorId: string) {
  return provider(doorId);
}

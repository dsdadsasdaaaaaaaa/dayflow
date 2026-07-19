let counter = 0;

/** Collision-safe-enough unique id for local data. */
export function uid(): string {
  counter = (counter + 1) % 0xffff;
  return (
    Date.now().toString(36) +
    '-' +
    counter.toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

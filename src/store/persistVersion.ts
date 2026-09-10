/**
 * Shared persistence versioning for every DayFlow store.
 *
 * All stores declare `version: PERSIST_VERSION` with `migrate: migrateStore`.
 * Until a real shape change ships, the migration is the identity — its whole
 * job is EXISTING: without a version+migrate pair, zustand DISCARDS persisted
 * state on any future version bump, so the hook must predate the first
 * breaking change. When a store's shape changes: bump PERSIST_VERSION (or move
 * that store to its own constant) and branch on `fromVersion` here or in a
 * store-local migrate.
 *
 * Historical note: state persisted before versioning carries version 0 and
 * flows through this identity migration unchanged.
 *
 * Version 2 exists for the messages store alone, which collapses messages
 * stored more than once under different gateway ids. Version 3 is the tasks
 * store, collapsing school entries imported twice — once from the weekly
 * newsletter and once from the year calendar. Every other store rides both
 * bumps through the identity migration below.
 */
export const PERSIST_VERSION = 3;

export function migrateStore<S>(persisted: unknown, _fromVersion: number): S {
  return persisted as S;
}

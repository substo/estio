// Compatibility exports for older error handlers. Runtime transport is StudioDb.
export { StudioDbError as StudioRestError } from "./db";
export { isStudioProviderUnavailable, studioProviderRestricted } from "./rest-client";

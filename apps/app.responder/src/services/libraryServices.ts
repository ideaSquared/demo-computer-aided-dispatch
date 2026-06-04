/**
 * App-wide API client init. Use `??` not `||` on VITE_API_BASE_URL so
 * an empty string from Compose passes through (Vite proxy mode). See
 * .claude/skills/api-fetch and .claude/skills/new-app.
 */

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '') as string;

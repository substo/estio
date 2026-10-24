import assert from "node:assert/strict";
import test from "node:test";
import { hasStudioSupabaseConfig } from "./config";

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as unknown as NodeJS.ProcessEnv;

test("Studio Supabase configuration requires both server values", () => {
  assert.equal(hasStudioSupabaseConfig(env({ STUDIO_SUPABASE_URL: "https://studio.example.supabase.co" })), false);
  assert.equal(hasStudioSupabaseConfig(env({ STUDIO_SUPABASE_SERVICE_ROLE_KEY: "secret" })), false);
});

test("Studio Supabase configuration accepts HTTPS projects and local HTTP only", () => {
  assert.equal(hasStudioSupabaseConfig(env({
    STUDIO_SUPABASE_URL: "https://studio.example.supabase.co",
    STUDIO_SUPABASE_SERVICE_ROLE_KEY: "secret",
  })), true);
  assert.equal(hasStudioSupabaseConfig(env({
    STUDIO_SUPABASE_URL: "http://localhost:54321",
    STUDIO_SUPABASE_SERVICE_ROLE_KEY: "secret",
  })), true);
  assert.equal(hasStudioSupabaseConfig(env({
    STUDIO_SUPABASE_URL: "http://studio.example.supabase.co",
    STUDIO_SUPABASE_SERVICE_ROLE_KEY: "secret",
  })), false);
  assert.equal(hasStudioSupabaseConfig(env({
    STUDIO_SUPABASE_URL: "not a URL",
    STUDIO_SUPABASE_SERVICE_ROLE_KEY: "secret",
  })), false);
});

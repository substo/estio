import assert from "node:assert/strict";
import test from "node:test";
import { buildIsolatedCodexEnvironment } from "./codex-environment";

test("isolated Codex environments strip ambient billing credentials", () => {
    const env = buildIsolatedCodexEnvironment({
        baseEnv: {
            PATH: "/bin",
            CODEX_ACCESS_TOKEN: "ambient-codex",
            OPENAI_API_KEY: "ambient-api",
            OPENAI_ORGANIZATION: "ambient-org",
        },
        codexHome: "/tmp/scope-a",
    });
    assert.equal(env.PATH, "/bin");
    assert.equal(env.CODEX_HOME, "/tmp/scope-a");
    assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.OPENAI_ORGANIZATION, undefined);
});

test("an explicit scoped access token is the only inherited Codex credential", () => {
    const env = buildIsolatedCodexEnvironment({
        baseEnv: { CODEX_ACCESS_TOKEN: "ambient", OPENAI_API_KEY: "ambient-api" },
        codexHome: "/tmp/location-a",
        accessToken: "location-token",
    });
    assert.equal(env.CODEX_ACCESS_TOKEN, "location-token");
    assert.equal(env.OPENAI_API_KEY, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Socks5ConnectionState } from "./socks5-state";

test("moves from SOCKS handshake parsing to opaque byte streaming", () => {
    const state = new Socks5ConnectionState();
    assert.equal(state.phase, "greeting");

    state.acceptGreeting();
    assert.equal(state.phase, "request");

    state.acceptConnectRequest();
    assert.equal(state.phase, "stream");
    assert.equal(state.isStreaming, true);
});

test("only emits a SOCKS failure while a connect request is pending", () => {
    const state = new Socks5ConnectionState();
    state.acceptGreeting();
    assert.equal(state.shouldWriteFailure(false), true);

    state.acceptConnectRequest();
    assert.equal(state.shouldWriteFailure(true), true);
    assert.equal(state.shouldWriteFailure(false), false);
});

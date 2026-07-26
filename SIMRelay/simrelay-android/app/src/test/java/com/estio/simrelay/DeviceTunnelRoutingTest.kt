package com.estio.simrelay

import com.estio.simrelay.api.TunnelTokenResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class DeviceTunnelRoutingTest {
    private fun config(url: String, nodeId: String, epoch: Int) = TunnelTokenResponse(
        tunnelToken = "redacted-test-token",
        gatewayUrl = url,
        expiresInSeconds = 300,
        bindingId = "binding-1",
        nodeId = nodeId,
        assignmentEpoch = epoch,
    )

    @Test
    fun usesReturnedAssignedNodeUrl() {
        assertEquals(
            "wss://node-a.estio.co/device-tunnel/v1/device",
            DeviceTunnelRouting.endpoint(config("wss://node-a.estio.co/device-tunnel", "node-a", 4)),
        )
    }

    @Test
    fun freshTokenCanRouteReconnectToReassignedNode() {
        val oldEndpoint = DeviceTunnelRouting.endpoint(config("wss://node-a.estio.co/device-tunnel", "node-a", 4))
        val newEndpoint = DeviceTunnelRouting.endpoint(config("wss://node-b.estio.co/device-tunnel", "node-b", 5))
        assertNotEquals(oldEndpoint, newEndpoint)
        assertTrue(newEndpoint.startsWith("wss://node-b.estio.co/"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonTlsOrCredentialBearingGatewayUrls() {
        DeviceTunnelRouting.endpoint(config("ws://user:secret@127.0.0.1:3220", "node-a", 1))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnexpectedHostSuffixOrAlternateEndpoint() {
        DeviceTunnelRouting.endpoint(config("wss://node-a.example.test/alternate", "node-a", 1))
    }

    @Test
    fun reconnectBackoffUsesBoundedFullJitter() {
        val policy = DeviceTunnelReconnectPolicy(initialCapMs = 5_000, maximumCapMs = 60_000, random = Random(7))
        var cap = policy.initialCap()
        repeat(8) {
            val delay = policy.fullJitterDelay(cap)
            assertTrue(delay in 0..cap)
            cap = policy.nextCap(cap)
        }
        assertEquals(60_000, cap)
    }

    @Test
    fun livenessPolicyFencesSilentGatewaySockets() {
        val policy = DeviceTunnelLivenessPolicy(maximumSilenceMs = 75_000, checkIntervalMs = 15_000)
        assertEquals(15_000, policy.checkInterval())
        assertTrue(!policy.isStale(lastGatewayFrameAtMs = 10_000, nowMs = 85_000))
        assertTrue(policy.isStale(lastGatewayFrameAtMs = 10_000, nowMs = 85_001))
    }

    @Test
    fun reconnectGenerationIsAppliedExactlyOnce() {
        assertTrue(DeviceTunnelDiagnostics.shouldApplyReconnect(remoteGeneration = 3, appliedGeneration = 2))
        assertTrue(!DeviceTunnelDiagnostics.shouldApplyReconnect(remoteGeneration = 3, appliedGeneration = 3))
        assertTrue(!DeviceTunnelDiagnostics.shouldApplyReconnect(remoteGeneration = 2, appliedGeneration = 3))
    }

    @Test
    fun diagnosticsReduceFailuresToSafeCodes() {
        assertEquals("AUTH_REJECTED", DeviceTunnelDiagnostics.classify(IllegalStateException("Tunnel token unavailable (403)")))
        assertEquals("NO_ANDROID_NETWORK", DeviceTunnelDiagnostics.classify(IllegalStateException("No active Android network")))
        assertEquals("ESTIO_UNREACHABLE", DeviceTunnelDiagnostics.classify(java.io.IOException("connection reset")))
    }
}

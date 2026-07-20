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
            "wss://node-a.example.test/device-tunnel/v1/device",
            DeviceTunnelRouting.endpoint(config("wss://node-a.example.test/device-tunnel", "node-a", 4)),
        )
    }

    @Test
    fun freshTokenCanRouteReconnectToReassignedNode() {
        val oldEndpoint = DeviceTunnelRouting.endpoint(config("wss://node-a.example.test/device-tunnel", "node-a", 4))
        val newEndpoint = DeviceTunnelRouting.endpoint(config("wss://node-b.example.test/device-tunnel", "node-b", 5))
        assertNotEquals(oldEndpoint, newEndpoint)
        assertTrue(newEndpoint.startsWith("wss://node-b.example.test/"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonTlsOrCredentialBearingGatewayUrls() {
        DeviceTunnelRouting.endpoint(config("ws://user:secret@127.0.0.1:3220", "node-a", 1))
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
}

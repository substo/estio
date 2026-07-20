package com.estio.simrelay

import com.estio.simrelay.api.TunnelTokenResponse
import java.net.URI
import kotlin.random.Random

internal object DeviceTunnelRouting {
    fun endpoint(config: TunnelTokenResponse): String {
        val raw = config.gatewayUrl.trim().trimEnd('/')
        val uri = try { URI(raw) } catch (_: Exception) { throw IllegalArgumentException("Invalid tunnel gateway URL") }
        require(
            uri.scheme.equals("wss", ignoreCase = true)
                && !uri.host.isNullOrBlank()
                && uri.userInfo == null
                && uri.query == null
                && uri.fragment == null
        ) { "Invalid tunnel gateway URL" }
        return if (raw.endsWith("/v1/device")) raw else "$raw/v1/device"
    }
}

internal class DeviceTunnelReconnectPolicy(
    private val initialCapMs: Long = 5_000L,
    private val maximumCapMs: Long = 60_000L,
    private val random: Random = Random.Default,
) {
    init {
        require(initialCapMs > 0 && maximumCapMs >= initialCapMs)
    }

    fun initialCap() = initialCapMs

    fun nextCap(currentCapMs: Long) = (currentCapMs * 2).coerceAtMost(maximumCapMs)

    fun fullJitterDelay(currentCapMs: Long): Long = random.nextLong(0, currentCapMs.coerceAtMost(maximumCapMs) + 1)
}

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
                && (uri.host.equals(BuildConfig.DEVICE_TUNNEL_GATEWAY_HOST_SUFFIX, ignoreCase = true)
                    || uri.host.lowercase().endsWith(".${BuildConfig.DEVICE_TUNNEL_GATEWAY_HOST_SUFFIX.lowercase()}"))
                && uri.userInfo == null
                && uri.query == null
                && uri.fragment == null
                && uri.port in listOf(-1, 443)
                && uri.path == "/device-tunnel"
        ) { "Invalid tunnel gateway URL" }
        return "$raw/v1/device"
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

internal class DeviceTunnelLivenessPolicy(
    private val maximumSilenceMs: Long = 75_000L,
    private val checkIntervalMs: Long = 15_000L,
) {
    init {
        require(maximumSilenceMs > checkIntervalMs && checkIntervalMs > 0)
    }

    fun checkInterval() = checkIntervalMs

    fun isStale(lastGatewayFrameAtMs: Long, nowMs: Long): Boolean =
        nowMs - lastGatewayFrameAtMs > maximumSilenceMs
}

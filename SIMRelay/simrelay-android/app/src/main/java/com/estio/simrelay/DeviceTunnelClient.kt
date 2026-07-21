package com.estio.simrelay

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import android.util.Base64
import com.estio.simrelay.api.ApiClient
import com.estio.simrelay.api.TunnelTokenRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

class DeviceTunnelClient(
    context: Context,
    private val scope: CoroutineScope,
    private val onConnectionStateChanged: (Boolean) -> Unit = {},
) {
    private val appContext = context.applicationContext
    private val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
    private val sockets = ConcurrentHashMap<String, Socket>()
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    @Volatile private var webSocket: WebSocket? = null
    private val reconnectPolicy = DeviceTunnelReconnectPolicy()
    private val livenessPolicy = DeviceTunnelLivenessPolicy()

    suspend fun runForever() {
        var backoffCapMs = reconnectPolicy.initialCap()
        while (scope.isActive) {
            try {
                val challengeResponse = ApiClient.api.getTunnelChallenge(TunnelTokenRequest(action = "challenge"))
                val challenge = challengeResponse.body()?.challenge
                    ?: throw IllegalStateException("Tunnel challenge unavailable (${challengeResponse.code()})")
                val signature = DeviceKeyManager.signBase64(challenge)
                val tokenResponse = ApiClient.api.exchangeTunnelChallenge(
                    TunnelTokenRequest(action = "exchange", challenge = challenge, signature = signature)
                )
                val config = tokenResponse.body()
                    ?: throw IllegalStateException("Tunnel token unavailable (${tokenResponse.code()})")
                val opened = connectOnce(DeviceTunnelRouting.endpoint(config), config.tunnelToken)
                if (opened) {
                    backoffCapMs = reconnectPolicy.initialCap()
                } else {
                    delay(reconnectPolicy.fullJitterDelay(backoffCapMs))
                    backoffCapMs = reconnectPolicy.nextCap(backoffCapMs)
                }
            } catch (_: Exception) {
                closeStreams()
                delay(reconnectPolicy.fullJitterDelay(backoffCapMs))
                backoffCapMs = reconnectPolicy.nextCap(backoffCapMs)
            }
        }
    }

    fun networkChanged() {
        onConnectionStateChanged(false)
        webSocket?.cancel()
        closeStreams()
    }

    fun close() {
        onConnectionStateChanged(false)
        webSocket?.close(1000, "Relay stopped")
        webSocket = null
        closeStreams()
        client.dispatcher.executorService.shutdown()
    }

    private suspend fun connectOnce(endpoint: String, token: String): Boolean = suspendCancellableCoroutine<Boolean> { continuation ->
        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer $token")
            .build()
        var completed = false
        var opened = false
        var lastGatewayFrameAtMs = SystemClock.elapsedRealtime()
        var watchdogJob: Job? = null
        val stateLock = Any()

        fun markGatewayFrame() {
            synchronized(stateLock) {
                lastGatewayFrameAtMs = SystemClock.elapsedRealtime()
            }
        }

        fun finish() {
            val result = synchronized(stateLock) {
                if (completed) null else {
                    completed = true
                    opened
                }
            } ?: return
            watchdogJob?.cancel()
            onConnectionStateChanged(false)
            closeStreams()
            if (continuation.isActive) continuation.resume(result)
        }

        fun startLivenessWatchdog(ws: WebSocket) {
            watchdogJob?.cancel()
            watchdogJob = scope.launch {
                while (isActive) {
                    delay(livenessPolicy.checkInterval())
                    val stale = synchronized(stateLock) {
                        !completed && livenessPolicy.isStale(lastGatewayFrameAtMs, SystemClock.elapsedRealtime())
                    }
                    if (stale) {
                        if (webSocket === ws) webSocket = null
                        ws.cancel()
                        finish()
                        break
                    }
                }
            }
        }
        val listener = object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                synchronized(stateLock) {
                    opened = true
                    lastGatewayFrameAtMs = SystemClock.elapsedRealtime()
                }
                webSocket = ws
                ws.send(JSONObject().put("type", "hello").put("networkType", networkType()).toString())
                onConnectionStateChanged(true)
                startLivenessWatchdog(ws)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                markGatewayFrame()
                handleFrame(ws, text)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (webSocket === ws) webSocket = null
                finish()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (webSocket === ws) webSocket = null
                finish()
            }
        }
        val ws = client.newWebSocket(request, listener)
        continuation.invokeOnCancellation { ws.cancel() }
    }

    private fun handleFrame(ws: WebSocket, text: String) {
        val frame = try { JSONObject(text) } catch (_: Exception) { return }
        val type = frame.optString("type")
        val streamId = frame.optString("streamId")
        when (type) {
            "open" -> openStream(ws, streamId, frame.optString("host"), frame.optInt("port"))
            "data" -> {
                val data = try { Base64.decode(frame.optString("data"), Base64.DEFAULT) } catch (_: Exception) { null }
                if (data == null || data.size > 512 * 1024) closeStream(ws, streamId)
                else try { sockets[streamId]?.getOutputStream()?.write(data) } catch (_: Exception) { closeStream(ws, streamId) }
            }
            "close" -> closeStream(ws, streamId, notify = false)
            "ping" -> ws.send(JSONObject().put("type", "pong").put("networkType", networkType()).toString())
        }
    }

    private fun openStream(ws: WebSocket, streamId: String, host: String, port: Int) {
        if (streamId.isBlank() || !isAllowedHost(host) || port != 443 || sockets.size >= 64) {
            sendOpenResult(ws, streamId, false, "Target is not allowed")
            return
        }
        scope.launch(Dispatchers.IO) {
            var openConfirmed = false
            try {
                val network = connectivity.activeNetwork ?: throw IllegalStateException("No active Android network")
                val address = network.getAllByName(host).firstOrNull { address ->
                    !address.isAnyLocalAddress
                        && !address.isLoopbackAddress
                        && !address.isLinkLocalAddress
                        && !address.isSiteLocalAddress
                        && !address.isMulticastAddress
                } ?: throw IllegalStateException("DNS returned no public address")
                val socket = network.socketFactory.createSocket()
                sockets[streamId] = socket
                socket.connect(InetSocketAddress(address, port), 15_000)
                sendOpenResult(ws, streamId, true, null)
                openConfirmed = true
                val buffer = ByteArray(32 * 1024)
                val input = socket.getInputStream()
                while (scope.isActive && sockets[streamId] === socket) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    val encoded = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
                    if (!ws.send(JSONObject().put("type", "data").put("streamId", streamId).put("data", encoded).toString())) break
                }
            } catch (e: Exception) {
                if (!openConfirmed) sendOpenResult(ws, streamId, false, e.message)
            } finally {
                closeStream(ws, streamId)
            }
        }
    }

    private fun sendOpenResult(ws: WebSocket, streamId: String, ok: Boolean, error: String?) {
        val frame = JSONObject().put("type", "open_result").put("streamId", streamId).put("ok", ok)
        if (!error.isNullOrBlank()) frame.put("error", error.take(160))
        ws.send(frame.toString())
    }

    private fun closeStream(ws: WebSocket, streamId: String, notify: Boolean = true) {
        sockets.remove(streamId)?.runCatching { close() }
        if (notify && streamId.isNotBlank()) {
            ws.send(JSONObject().put("type", "close").put("streamId", streamId).toString())
        }
    }

    private fun closeStreams() {
        sockets.values.forEach { it.runCatching { close() } }
        sockets.clear()
    }

    private fun isAllowedHost(host: String): Boolean {
        val normalized = host.trim().lowercase().trimEnd('.')
        if (!normalized.matches(Regex("^[a-z0-9.-]+$")) || normalized.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$"))) return false
        return listOf("whatsapp.com", "whatsapp.net", "fbcdn.net")
            .any { normalized == it || normalized.endsWith(".$it") }
    }

    private fun networkType(): String {
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return "unknown"
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
    }
}

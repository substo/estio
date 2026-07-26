package com.estio.simrelay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.estio.simrelay.api.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class TunnelForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "EstioWhatsAppNetworkRelay"
        const val ACTION_RESTART = "com.estio.simrelay.RESTART_STO"
        @Volatile
        var isRunning = false
            private set
        @Volatile
        var isConnected = false
            private set
        @Volatile
        var lastErrorCode: String? = null
            private set
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var tunnelClient: DeviceTunnelClient? = null
    private var tunnelJob: Job? = null
    private var connectivity: ConnectivityManager? = null
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            tunnelClient?.networkChanged()
        }

        override fun onLost(network: Network) {
            tunnelClient?.networkChanged()
        }
    }

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "WhatsApp network relay", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Estio WhatsApp Network Relay")
            .setContentText("Routing the assigned WhatsApp browser through this device")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(this, 2, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(2, notification)
        }

        val prefs = SecurePrefs.get(this)
        val token = prefs.getString("device_token", null) ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!RelayReliability.shouldRun(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val baseUrl = prefs.getString("base_url", "https://estio.co") ?: "https://estio.co"
        ApiClient.initBaseUrl(baseUrl)
        ApiClient.initToken(token)
        if (connectivity == null) {
            connectivity = getSystemService(ConnectivityManager::class.java).also {
                it.registerDefaultNetworkCallback(networkCallback)
            }
        }
        if (intent?.action != ACTION_RESTART && tunnelClient != null && tunnelJob?.isActive == true) {
            return START_STICKY
        }
        restartTunnelClient()
        isRunning = true
        return START_STICKY
    }

    private fun restartTunnelClient() {
        isConnected = false
        lastErrorCode = null
        tunnelJob?.cancel()
        tunnelClient?.close()
        lateinit var client: DeviceTunnelClient
        client = DeviceTunnelClient(this, scope) { connected, errorCode ->
            if (tunnelClient === client) {
                isConnected = connected
                lastErrorCode = errorCode
            }
        }
        tunnelClient = client
        tunnelJob = scope.launch { client.runForever() }
    }

    override fun onDestroy() {
        connectivity?.runCatching { unregisterNetworkCallback(networkCallback) }
        tunnelClient?.close()
        tunnelClient = null
        tunnelJob = null
        isRunning = false
        isConnected = false
        lastErrorCode = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (RelayReliability.shouldRun(this)) RelayReliability.scheduleImmediate(this)
        super.onTaskRemoved(rootIntent)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

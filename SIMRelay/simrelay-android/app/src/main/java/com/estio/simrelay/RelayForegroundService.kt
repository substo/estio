package com.estio.simrelay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import com.estio.simrelay.api.ApiClient
import com.estio.simrelay.api.InboundSmsRequest
import com.estio.simrelay.api.HeartbeatRequest
import com.estio.simrelay.api.JobResultRequest
import kotlinx.coroutines.*

class RelayForegroundService : Service() {

    companion object {
        const val ACTION_FLUSH_INBOUND = "com.estio.simrelay.FLUSH_INBOUND"
        var isRunning = false
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val CHANNEL_ID = "SimRelayServiceChannel"
    private lateinit var sentSmsMirror: SentSmsMirror
    private lateinit var inboundSmsQueue: InboundSmsQueue
    private var pollingJob: Job? = null
    private var inboundFlushJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        sentSmsMirror = SentSmsMirror(this)
        inboundSmsQueue = InboundSmsQueue(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Estio SIM Relay Active")
            .setContentText("Connected to Estio - Relaying SMS")
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(1, notification)
        }

        isRunning = true
        RelayReliability.schedulePeriodic(this)

        val prefs = SecurePrefs.get(this)
        val token = prefs.getString("device_token", null)
        val baseUrl = prefs.getString("base_url", "https://estio.co")
        
        if (token != null) {
            ApiClient.initBaseUrl(baseUrl!!)
            ApiClient.initToken(token)
            if (intent?.action == ACTION_FLUSH_INBOUND) {
                flushInboundSmsQueue()
            }
            startPolling()
        } else {
            stopSelf()
        }

        return START_STICKY
    }

    private val activeJobIds = mutableSetOf<String>()

    private fun startPolling() {
        if (pollingJob?.isActive == true) return
        pollingJob = serviceScope.launch {
            while (isActive) {
                pollSmsJobs()
                heartbeatAndSuperviseSto()
                runCatching { sentSmsMirror.pollOnce() }
                flushInboundSmsQueue()
                delay(5000)
            }
        }
    }

    private suspend fun pollSmsJobs() {
        try {
            val response = ApiClient.api.getJobs()
            if (response.isSuccessful && response.body() != null) {
                val jobs = response.body()!!
                        
                if (activeJobIds.size > 1000) activeJobIds.clear()

                for (job in jobs) {
                    if (activeJobIds.add(job.job_id)) {
                        sendSms(job.job_id, job.to, job.body)
                    }
                }
            }
        } catch (_: Exception) {
            // Heartbeat and STO supervision still run when SMS polling fails.
        }
    }

    private suspend fun heartbeatAndSuperviseSto() {
        val prefs = SecurePrefs.get(this)
        val appliedGeneration = prefs.getLong(RelayReliability.PREF_RECONNECT_GENERATION, 0)
        val powerManager = getSystemService(PowerManager::class.java)
        val heartbeat = HeartbeatRequest(
            app_version = BuildConfig.VERSION_NAME,
            sto_reconnect_applied_generation = appliedGeneration,
            sto_state = when {
                TunnelForegroundService.isConnected -> "connected"
                TunnelForegroundService.isRunning -> "reconnecting"
                else -> "stopped"
            },
            sto_error_code = TunnelForegroundService.lastErrorCode,
            battery_optimization_ignored = powerManager.isIgnoringBatteryOptimizations(packageName),
        )
        try {
            val response = ApiClient.api.heartbeat(heartbeat)
            val control = response.body()
            if (response.isSuccessful && control != null) {
                RelayReliability.setShouldRun(this, control.sto_should_run)
                if (
                    control.sto_should_run
                    && DeviceTunnelDiagnostics.shouldApplyReconnect(
                        remoteGeneration = control.sto_reconnect_generation,
                        appliedGeneration = appliedGeneration,
                    )
                ) {
                    RelayReliability.startPairedServices(this, restartTunnel = true)
                    prefs.edit()
                        .putLong(RelayReliability.PREF_RECONNECT_GENERATION, control.sto_reconnect_generation)
                        .apply()
                } else if (control.sto_should_run && !TunnelForegroundService.isRunning) {
                    RelayReliability.startPairedServices(this)
                }
            }
        } catch (_: Exception) {
            if (RelayReliability.shouldRun(this) && !TunnelForegroundService.isRunning) {
                RelayReliability.startPairedServices(this)
            }
        }
    }

    private fun sendSms(jobId: String, destination: String, message: String) {
        serviceScope.launch {
            try {
                val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    getSystemService(SmsManager::class.java)
                } else {
                    SmsManager.getDefault()
                }
                sentSmsMirror.suppressRelaySend(destination, message)
                val parts = smsManager.divideMessage(message)
                if (parts.size <= 1) {
                    smsManager.sendTextMessage(destination, null, message, null, null)
                } else {
                    smsManager.sendMultipartTextMessage(destination, null, parts, null, null)
                }
                ApiClient.api.reportJobResult(JobResultRequest(jobId, "sent"))
            } catch (e: Exception) {
                ApiClient.api.reportJobResult(JobResultRequest(jobId, "failed", e.message))
            }
        }
    }

    private fun flushInboundSmsQueue() {
        if (inboundFlushJob?.isActive == true) return
        inboundFlushJob = serviceScope.launch {
            for (item in inboundSmsQueue.listDue()) {
                try {
                    val response = ApiClient.api.reportInboundSms(
                        InboundSmsRequest(
                            from = item.from,
                            body = item.body,
                            received_at_ms = item.receivedAtMs,
                            to = item.to
                        )
                    )
                    if (response.isSuccessful) {
                        inboundSmsQueue.markSent(item.id)
                    } else {
                        inboundSmsQueue.markFailed(item.id, "HTTP ${response.code()}")
                    }
                } catch (e: Exception) {
                    inboundSmsQueue.markFailed(item.id, e.message)
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        serviceScope.cancel()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        RelayReliability.scheduleImmediate(this)
        super.onTaskRemoved(rootIntent)
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "SIM Relay Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }
}

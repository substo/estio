package com.estio.simrelay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import com.estio.simrelay.api.ApiClient
import com.estio.simrelay.api.JobResultRequest
import kotlinx.coroutines.*

class RelayForegroundService : Service() {

    companion object {
        var isRunning = false
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private val CHANNEL_ID = "SimRelayServiceChannel"

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
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

        val prefs = getSharedPreferences("estio_prefs", Context.MODE_PRIVATE)
        val token = prefs.getString("device_token", null)
        val baseUrl = prefs.getString("base_url", "https://estio.co")
        
        if (token != null) {
            ApiClient.initBaseUrl(baseUrl!!)
            ApiClient.initToken(token)
            startPolling()
        } else {
            stopSelf()
        }

        return START_STICKY
    }

    private fun startPolling() {
        serviceScope.launch {
            while (isActive) {
                try {
                    val response = ApiClient.api.getJobs()
                    if (response.isSuccessful && response.body() != null) {
                        val jobs = response.body()!!
                        for (job in jobs) {
                            sendSms(job.job_id, job.to, job.body)
                        }
                    }
                    ApiClient.api.heartbeat()
                } catch (e: Exception) {
                    // Ignored
                }
                delay(5000)
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
                smsManager.sendTextMessage(destination, null, message, null, null)
                ApiClient.api.reportJobResult(JobResultRequest(jobId, "sent"))
            } catch (e: Exception) {
                ApiClient.api.reportJobResult(JobResultRequest(jobId, "failed", e.message))
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        serviceScope.cancel()
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

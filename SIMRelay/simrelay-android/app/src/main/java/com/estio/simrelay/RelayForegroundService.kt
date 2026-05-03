package com.estio.simrelay

import android.app.Notification
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

    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private val CHANNEL_ID = "SimRelayServiceChannel"

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Estio SIM Relay Active")
            .setContentText("Listening for outgoing SMS jobs...")
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .build()

        startForeground(1, notification)

        // Ensure token is loaded
        val prefs = getSharedPreferences("estio_prefs", Context.MODE_PRIVATE)
        val token = prefs.getString("device_token", null)
        if (token != null) {
            ApiClient.initToken(token)
            startPolling()
        }

        return START_STICKY
    }

    private fun startPolling() {
        serviceScope.launch {
            while (isActive) {
                try {
                    // Poll Jobs
                    val response = ApiClient.api.getJobs()
                    if (response.isSuccessful && response.body() != null) {
                        val jobs = response.body()!!.jobs
                        for (job in jobs) {
                            sendSms(job.id, job.destinationNumber, job.messageBody)
                        }
                    }

                    // Heartbeat
                    ApiClient.api.heartbeat()

                } catch (e: Exception) {
                    // Log or handle error implicitly (retry next cycle)
                }

                // Poll every 5 seconds
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

                // Actually dispatch SMS
                smsManager.sendTextMessage(destination, null, message, null, null)

                // Report success
                ApiClient.api.reportJobResult(JobResultRequest(jobId, "sent"))
            } catch (e: Exception) {
                // Report failure
                ApiClient.api.reportJobResult(JobResultRequest(jobId, "failed", e.message))
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "SIM Relay Service Channel",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }
}

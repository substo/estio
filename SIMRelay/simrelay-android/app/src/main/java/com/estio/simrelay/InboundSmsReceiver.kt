package com.estio.simrelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log

class InboundSmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val queue = InboundSmsQueue(context)
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            val groupedMessages = messages
                .filter { it.displayOriginatingAddress != null && it.displayMessageBody != null }
                .groupBy { sms -> sms.displayOriginatingAddress ?: "" }

            for ((sender, parts) in groupedMessages) {
                val body = parts.joinToString(separator = "") { it.displayMessageBody ?: "" }
                val timestamp = parts.minOfOrNull { it.timestampMillis } ?: System.currentTimeMillis()
                if (sender.isBlank() || body.isBlank()) continue

                queue.enqueue(from = sender, body = body, receivedAtMs = timestamp)
                wakeRelayService(context)
            }
        }
    }

    private fun wakeRelayService(context: Context) {
        try {
            val serviceIntent = Intent(context, RelayForegroundService::class.java).apply {
                action = RelayForegroundService.ACTION_FLUSH_INBOUND
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to wake relay service for inbound SMS", e)
        }
    }

    companion object {
        private const val TAG = "InboundSmsReceiver"
    }
}

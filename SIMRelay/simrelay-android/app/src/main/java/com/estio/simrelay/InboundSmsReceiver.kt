package com.estio.simrelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.estio.simrelay.api.ApiClient
import com.estio.simrelay.api.InboundSmsRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class InboundSmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val sender = sms.displayOriginatingAddress
                val body = sms.displayMessageBody
                val timestamp = sms.timestampMillis

                if (sender != null && body != null) {
                    // Fire and forget POST to CRM
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            val prefs = context.getSharedPreferences("estio_prefs", Context.MODE_PRIVATE)
                            val token = prefs.getString("device_token", null)
                            if (token != null) {
                                ApiClient.initToken(token)
                                val req = InboundSmsRequest(sender, body, timestamp)
                                ApiClient.api.reportInboundSms(req)
                            }
                        } catch (e: Exception) {
                            // Ignored (or we could queue failed inbound messages in local DB for retry)
                        }
                    }
                }
            }
        }
    }
}

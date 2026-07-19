package com.estio.simrelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs = SecurePrefs.get(context)
            val token = prefs.getString("device_token", null)
            
            // Only auto-start if paired
            if (token != null) {
                val serviceIntent = Intent(context, RelayForegroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                    context.startForegroundService(Intent(context, TunnelForegroundService::class.java))
                } else {
                    context.startService(serviceIntent)
                    context.startService(Intent(context, TunnelForegroundService::class.java))
                }
            }
        }
    }
}

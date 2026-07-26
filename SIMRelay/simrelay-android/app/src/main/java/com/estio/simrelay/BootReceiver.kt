package com.estio.simrelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val prefs = SecurePrefs.get(context)
            val token = prefs.getString("device_token", null)
            
            // Only auto-start if paired
            if (token != null) {
                RelayReliability.schedulePeriodic(context)
                RelayReliability.startPairedServices(context)
            }
        }
    }
}

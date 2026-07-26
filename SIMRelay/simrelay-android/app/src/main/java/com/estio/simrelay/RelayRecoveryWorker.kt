package com.estio.simrelay

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

object RelayReliability {
    const val PREF_STO_SHOULD_RUN = "sto_should_run"
    const val PREF_RECONNECT_GENERATION = "sto_reconnect_applied_generation"
    private const val PERIODIC_WORK = "estio-relay-recovery"
    private const val IMMEDIATE_WORK = "estio-relay-recovery-immediate"

    fun shouldRun(context: Context): Boolean {
        val prefs = SecurePrefs.get(context)
        return prefs.getString("device_token", null) != null
            && prefs.getBoolean(PREF_STO_SHOULD_RUN, true)
    }

    fun setShouldRun(context: Context, enabled: Boolean) {
        SecurePrefs.get(context).edit().putBoolean(PREF_STO_SHOULD_RUN, enabled).apply()
    }

    fun startPairedServices(context: Context, restartTunnel: Boolean = false): Boolean {
        if (SecurePrefs.get(context).getString("device_token", null) == null) return false
        return try {
            val relayIntent = Intent(context, RelayForegroundService::class.java)
            val tunnelIntent = Intent(context, TunnelForegroundService::class.java).apply {
                if (restartTunnel) action = TunnelForegroundService.ACTION_RESTART
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(relayIntent)
                if (shouldRun(context)) context.startForegroundService(tunnelIntent)
            } else {
                context.startService(relayIntent)
                if (shouldRun(context)) context.startService(tunnelIntent)
            }
            true
        } catch (_: RuntimeException) {
            false
        }
    }

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<RelayRecoveryWorker>(15, TimeUnit.MINUTES)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    fun scheduleImmediate(context: Context) {
        val request = OneTimeWorkRequestBuilder<RelayRecoveryWorker>()
            .setInitialDelay(10, TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(IMMEDIATE_WORK)
    }
}

class RelayRecoveryWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (SecurePrefs.get(applicationContext).getString("device_token", null) == null) {
            return Result.success()
        }
        return if (RelayReliability.startPairedServices(applicationContext)) {
            Result.success()
        } else {
            Result.retry()
        }
    }
}

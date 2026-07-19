package com.estio.simrelay

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.PhoneNumberUtils
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/**
 * Best-effort SIM line-number detection. Carriers do not always provision the
 * subscriber number on the SIM, so callers must support a manual fallback.
 */
object SimPhoneNumberDetector {
    @SuppressLint("MissingPermission")
    fun detect(context: Context): String? {
        if (!hasPermission(context, Manifest.permission.READ_PHONE_NUMBERS) &&
            !hasPermission(context, Manifest.permission.READ_SMS)
        ) {
            return null
        }

        val subscriptionManager = context.getSystemService(SubscriptionManager::class.java)
            ?: return null
        val subscriptions = if (hasPermission(context, Manifest.permission.READ_PHONE_STATE)) {
            runCatching { subscriptionManager.activeSubscriptionInfoList.orEmpty() }
                .getOrDefault(emptyList())
        } else {
            emptyList()
        }
        val byId = subscriptions.associateBy { it.subscriptionId }
        val subscriptionIds = linkedSetOf<Int>()
        SubscriptionManager.getDefaultSmsSubscriptionId()
            .takeIf(SubscriptionManager::isValidSubscriptionId)
            ?.let(subscriptionIds::add)
        subscriptions.forEach { subscriptionIds.add(it.subscriptionId) }

        for (subscriptionId in subscriptionIds) {
            val subscription = byId[subscriptionId]
            val rawNumber = runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    subscriptionManager.getPhoneNumber(subscriptionId)
                } else {
                    @Suppress("DEPRECATION")
                    subscription?.number
                }
            }.getOrNull()
            normalize(rawNumber, countryIso(context, subscriptionId, subscription))?.let { return it }
        }
        return null
    }

    private fun countryIso(
        context: Context,
        subscriptionId: Int,
        subscription: SubscriptionInfo?,
    ): String? {
        subscription?.countryIso?.takeIf { it.isNotBlank() }?.let { return it }
        val telephonyManager = context.getSystemService(TelephonyManager::class.java) ?: return null
        return runCatching {
            telephonyManager.createForSubscriptionId(subscriptionId).networkCountryIso
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    private fun normalize(rawValue: String?, countryIso: String?): String? {
        val raw = rawValue?.trim().orEmpty()
        if (raw.isEmpty()) return null
        val international = if (raw.startsWith("00")) "+${raw.drop(2)}" else raw
        val digits = international.filter(Char::isDigit)
        if (international.startsWith("+") && digits.length in 8..15) return "+$digits"

        val country = countryIso?.trim()?.uppercase()?.takeIf { it.length == 2 } ?: return null
        return PhoneNumberUtils.formatNumberToE164(international, country)
            ?.takeIf { it.matches(Regex("^\\+[1-9]\\d{7,14}$")) }
    }

    private fun hasPermission(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}

package com.estio.simrelay

import android.content.Context
import android.net.Uri
import android.util.Log
import com.estio.simrelay.api.ApiClient
import com.estio.simrelay.api.ManualOutboundSmsRequest
import java.security.MessageDigest
import java.util.Locale

class SentSmsMirror(private val context: Context) {
    private val prefs = SecurePrefs.get(context)
    private val relaySuppression = mutableMapOf<String, Long>()

    fun suppressRelaySend(destination: String, body: String) {
        relaySuppression[buildMessageKey(destination, body)] = System.currentTimeMillis() + RELAY_SUPPRESSION_MS
    }

    suspend fun pollOnce() {
        val token = prefs.getString("device_token", null)
        if (token.isNullOrBlank()) return

        val now = System.currentTimeMillis()
        relaySuppression.entries.removeIf { it.value < now }

        val lastSyncedAt = prefs.getLong(KEY_LAST_SENT_SYNCED_AT, 0L)
        if (lastSyncedAt <= 0L) {
            prefs.edit().putLong(KEY_LAST_SENT_SYNCED_AT, now - INITIAL_LOOKBACK_MS).apply()
            return
        }

        val uri = Uri.parse("content://sms/sent")
        val projection = arrayOf("_id", "address", "body", "date")
        val selection = "date > ?"
        val args = arrayOf(lastSyncedAt.toString())
        val sortOrder = "date ASC"
        var newestConfirmedAt = lastSyncedAt

        try {
            context.contentResolver.query(uri, projection, selection, args, sortOrder)?.use { cursor ->
                val idIdx = cursor.getColumnIndex("_id")
                val addressIdx = cursor.getColumnIndex("address")
                val bodyIdx = cursor.getColumnIndex("body")
                val dateIdx = cursor.getColumnIndex("date")

                while (cursor.moveToNext()) {
                    val smsId = if (idIdx >= 0) cursor.getString(idIdx) ?: "" else ""
                    val address = if (addressIdx >= 0) cursor.getString(addressIdx) ?: "" else ""
                    val body = if (bodyIdx >= 0) cursor.getString(bodyIdx) ?: "" else ""
                    val sentAt = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
                    if (address.isBlank() || body.isBlank() || sentAt <= 0L) {
                        if (sentAt > newestConfirmedAt) newestConfirmedAt = sentAt
                        continue
                    }

                    val messageKey = buildMessageKey(address, body)
                    if (relaySuppression.containsKey(messageKey)) {
                        if (sentAt > newestConfirmedAt) newestConfirmedAt = sentAt
                        continue
                    }

                    val dedupeKey = buildDedupeKey(smsId, address, body, sentAt)
                    if (isAlreadySynced(dedupeKey)) {
                        if (sentAt > newestConfirmedAt) newestConfirmedAt = sentAt
                        continue
                    }

                    val response = ApiClient.api.reportManualOutboundSms(
                        ManualOutboundSmsRequest(
                            to = address,
                            body = body,
                            sent_at_ms = sentAt
                        )
                    )
                    if (response.isSuccessful) {
                        rememberSynced(dedupeKey)
                        if (sentAt > newestConfirmedAt) newestConfirmedAt = sentAt
                    } else {
                        Log.w(TAG, "Manual outbound SMS mirror failed: HTTP ${response.code()}")
                        break
                    }
                }
            }
        } catch (security: SecurityException) {
            Log.w(TAG, "Cannot read sent SMS. READ_SMS permission is missing.", security)
        } catch (e: Exception) {
            Log.e(TAG, "Manual outbound SMS mirror failed", e)
        } finally {
            if (newestConfirmedAt > lastSyncedAt) {
                prefs.edit().putLong(KEY_LAST_SENT_SYNCED_AT, newestConfirmedAt).apply()
            }
        }
    }

    private fun normalizePhone(value: String): String {
        return value.filter { it.isDigit() }.takeLast(12)
    }

    private fun buildMessageKey(address: String, body: String): String {
        return "${normalizePhone(address)}|${body.trim()}"
    }

    private fun buildDedupeKey(smsId: String, address: String, body: String, sentAt: Long): String {
        val raw = "$smsId|${normalizePhone(address)}|${body.trim()}|${sentAt / 30_000L}"
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray())
        return digest.joinToString("") { "%02x".format(Locale.US, it) }.take(24)
    }

    private fun isAlreadySynced(key: String): Boolean {
        return getSyncedKeys().contains(key)
    }

    private fun rememberSynced(key: String) {
        val updated = (getSyncedKeys() + key).takeLast(MAX_DEDUPE_KEYS)
        prefs.edit().putString(KEY_SYNCED_SENT_KEYS, updated.joinToString(",")).apply()
    }

    private fun getSyncedKeys(): List<String> {
        return prefs.getString(KEY_SYNCED_SENT_KEYS, "")
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: emptyList()
    }

    companion object {
        private const val TAG = "SentSmsMirror"
        private const val KEY_LAST_SENT_SYNCED_AT = "last_sent_sms_synced_at"
        private const val KEY_SYNCED_SENT_KEYS = "synced_sent_sms_keys"
        private const val INITIAL_LOOKBACK_MS = 60_000L
        private const val RELAY_SUPPRESSION_MS = 5 * 60_000L
        private const val MAX_DEDUPE_KEYS = 200
    }
}

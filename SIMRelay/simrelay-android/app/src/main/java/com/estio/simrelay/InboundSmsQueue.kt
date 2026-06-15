package com.estio.simrelay

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class PendingInboundSms(
    val id: String,
    val from: String,
    val body: String,
    val receivedAtMs: Long,
    val to: String? = null,
    val attemptCount: Int = 0,
    val lastAttemptAtMs: Long? = null,
    val lastError: String? = null
)

class InboundSmsQueue(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun enqueue(from: String, body: String, receivedAtMs: Long, to: String? = null): PendingInboundSms {
        val item = PendingInboundSms(
            id = UUID.randomUUID().toString(),
            from = from,
            body = body,
            receivedAtMs = receivedAtMs,
            to = to
        )
        synchronized(lock) {
            val items = readAllLocked().toMutableList()
            if (items.none { it.from == from && it.body == body && it.receivedAtMs == receivedAtMs }) {
                items.add(item)
                writeAllLocked(items.takeLast(MAX_PENDING_ITEMS))
            }
        }
        return item
    }

    fun listDue(nowMs: Long = System.currentTimeMillis()): List<PendingInboundSms> = synchronized(lock) {
        readAllLocked().filter { item ->
            item.attemptCount < MAX_ATTEMPTS &&
                (item.lastAttemptAtMs == null || nowMs - item.lastAttemptAtMs >= retryDelayMs(item.attemptCount))
        }
    }

    fun markSent(id: String) = synchronized(lock) {
        writeAllLocked(readAllLocked().filterNot { it.id == id })
    }

    fun markFailed(id: String, error: String?) = synchronized(lock) {
        val nowMs = System.currentTimeMillis()
        writeAllLocked(readAllLocked().map { item ->
            if (item.id == id) {
                item.copy(
                    attemptCount = item.attemptCount + 1,
                    lastAttemptAtMs = nowMs,
                    lastError = error?.take(300)
                )
            } else {
                item
            }
        })
    }

    private fun readAllLocked(): List<PendingInboundSms> {
        val raw = prefs.getString(KEY_PENDING, "[]") ?: "[]"
        val array = runCatching { JSONArray(raw) }.getOrElse { JSONArray() }
        return (0 until array.length()).mapNotNull { index ->
            runCatching {
                val obj = array.getJSONObject(index)
                PendingInboundSms(
                    id = obj.getString("id"),
                    from = obj.getString("from"),
                    body = obj.getString("body"),
                    receivedAtMs = obj.getLong("receivedAtMs"),
                    to = obj.optString("to").takeIf { it.isNotBlank() },
                    attemptCount = obj.optInt("attemptCount", 0),
                    lastAttemptAtMs = if (obj.has("lastAttemptAtMs")) obj.optLong("lastAttemptAtMs") else null,
                    lastError = obj.optString("lastError").takeIf { it.isNotBlank() }
                )
            }.getOrNull()
        }
    }

    private fun writeAllLocked(items: List<PendingInboundSms>) {
        val array = JSONArray()
        items.forEach { item ->
            array.put(JSONObject().apply {
                put("id", item.id)
                put("from", item.from)
                put("body", item.body)
                put("receivedAtMs", item.receivedAtMs)
                item.to?.let { put("to", it) }
                put("attemptCount", item.attemptCount)
                item.lastAttemptAtMs?.let { put("lastAttemptAtMs", it) }
                item.lastError?.let { put("lastError", it) }
            })
        }
        prefs.edit().putString(KEY_PENDING, array.toString()).apply()
    }

    private fun retryDelayMs(attemptCount: Int): Long {
        return when {
            attemptCount <= 0 -> 0L
            attemptCount == 1 -> 30_000L
            attemptCount == 2 -> 2 * 60_000L
            else -> 10 * 60_000L
        }
    }

    companion object {
        private const val PREFS_NAME = "estio_inbound_sms_queue"
        private const val KEY_PENDING = "pending_inbound_sms"
        private const val MAX_PENDING_ITEMS = 200
        private const val MAX_ATTEMPTS = 20
        private val lock = Any()
    }
}

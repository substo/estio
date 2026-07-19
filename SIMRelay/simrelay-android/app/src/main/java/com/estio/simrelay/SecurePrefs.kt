package com.estio.simrelay

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object SecurePrefs {
    private const val LEGACY_NAME = "estio_prefs"
    private const val SECURE_NAME = "estio_secure_prefs"

    fun get(context: Context): SharedPreferences {
        val appContext = context.applicationContext
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val secure = EncryptedSharedPreferences.create(
            appContext,
            SECURE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        val legacy = appContext.getSharedPreferences(LEGACY_NAME, Context.MODE_PRIVATE)
        if (!secure.contains("device_token") && legacy.contains("device_token")) {
            secure.edit()
                .putString("device_token", legacy.getString("device_token", null))
                .putString("base_url", legacy.getString("base_url", "https://estio.co"))
                .apply()
            legacy.edit().clear().apply()
        }
        return secure
    }
}

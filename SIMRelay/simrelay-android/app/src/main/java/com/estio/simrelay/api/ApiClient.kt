package com.estio.simrelay.api

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import com.estio.simrelay.BuildConfig
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object ApiClient {
    private var baseUrl: String = "https://estio.co"
    private var token: String? = null
    
    // We make api nullable just during rebuild, but typically it will be non-null.
    // For safety, we can expose a non-null property that throws if not initialized.
    private var _api: ApiService? = null
    val api: ApiService
        get() = _api ?: throw IllegalStateException("ApiClient not initialized")

    fun initToken(newToken: String) {
        token = newToken
    }

    fun initBaseUrl(newUrl: String) {
        baseUrl = newUrl
        rebuildApi()
    }

    private fun rebuildApi() {
        val authInterceptor = Interceptor { chain ->
            val requestBuilder = chain.request().newBuilder()
            token?.let {
                requestBuilder.addHeader("Authorization", "Bearer $it")
            }
            chain.proceed(requestBuilder.build())
        }

        val loggingInterceptor = HttpLoggingInterceptor().apply {
            redactHeader("Authorization")
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .build()

        val urlToUse = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

        val retrofit = Retrofit.Builder()
            .baseUrl(urlToUse)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        _api = retrofit.create(ApiService::class.java)
    }

    init {
        rebuildApi()
    }
}

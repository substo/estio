package com.estio.simrelay.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface ApiService {
    @POST("/api/sms-relay/gateway/pair")
    suspend fun pairDevice(@Body request: PairRequest): Response<PairResponse>

    @GET("/api/sms-relay/gateway/jobs")
    suspend fun getJobs(): Response<List<Job>>

    @POST("/api/sms-relay/gateway/job-result")
    suspend fun reportJobResult(@Body request: JobResultRequest): Response<Void>

    @POST("/api/sms-relay/gateway/inbound")
    suspend fun reportInboundSms(@Body request: InboundSmsRequest): Response<Void>

    @POST("/api/sms-relay/gateway/heartbeat")
    suspend fun heartbeat(): Response<Void>
}

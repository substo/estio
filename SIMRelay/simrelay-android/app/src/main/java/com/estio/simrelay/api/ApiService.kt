package com.estio.simrelay.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PATCH

interface ApiService {
    @POST("/api/sms-relay/gateway/pair")
    suspend fun pairDevice(@Body request: PairRequest): Response<PairResponse>

    @GET("/api/sms-relay/gateway/jobs")
    suspend fun getJobs(): Response<List<Job>>

    @POST("/api/sms-relay/gateway/job-result")
    suspend fun reportJobResult(@Body request: JobResultRequest): Response<Void>

    @POST("/api/sms-relay/gateway/inbound")
    suspend fun reportInboundSms(@Body request: InboundSmsRequest): Response<Void>

    @POST("/api/sms-relay/gateway/manual-outbound")
    suspend fun reportManualOutboundSms(@Body request: ManualOutboundSmsRequest): Response<Void>

    @PATCH("/api/sms-relay/gateway/heartbeat")
    suspend fun heartbeat(@Body request: HeartbeatRequest): Response<HeartbeatResponse>

    @POST("/api/device-relay/v1/tunnel-token")
    suspend fun getTunnelChallenge(@Body request: TunnelTokenRequest): Response<TunnelChallengeResponse>

    @POST("/api/device-relay/v1/tunnel-token")
    suspend fun exchangeTunnelChallenge(@Body request: TunnelTokenRequest): Response<TunnelTokenResponse>
}

package com.estio.simrelay.api

data class PairRequest(
    val pair_code: String,
    val tunnel_public_key: String? = null,
    val app_version: String? = null,
    val capabilities: List<String> = listOf("sms_relay")
)

data class PairResponse(
    val device_api_token: String,
    val device_id: String,
    val capabilities: List<String> = emptyList(),
    val tunnel_enabled: Boolean = false
)

data class TunnelTokenRequest(
    val action: String,
    val challenge: String? = null,
    val signature: String? = null
)

data class TunnelChallengeResponse(
    val challenge: String,
    val expiresAt: String,
    val credentialVersion: Int
)

data class TunnelTokenResponse(
    val tunnelToken: String,
    val gatewayUrl: String,
    val expiresInSeconds: Int,
    val bindingId: String
)

data class Job(
    val job_id: String,
    val to: String,
    val body: String,
    val conversation_id: String,
    val message_id: String
)

data class JobResultRequest(
    val job_id: String,
    val result: String,
    val error_message: String? = null
)

data class InboundSmsRequest(
    val from: String,
    val body: String,
    val received_at_ms: Long,
    val to: String? = null
)

data class ManualOutboundSmsRequest(
    val to: String,
    val body: String,
    val sent_at_ms: Long
)

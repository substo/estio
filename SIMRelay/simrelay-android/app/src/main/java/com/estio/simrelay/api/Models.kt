package com.estio.simrelay.api

data class PairRequest(
    val pair_code: String
)

data class PairResponse(
    val device_api_token: String,
    val device_id: String
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

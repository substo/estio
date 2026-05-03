package com.estio.simrelay.api

data class PairRequest(
    val pairingCode: String
)

data class PairResponse(
    val token: String,
    val deviceId: String
)

data class Job(
    val id: String,
    val destinationNumber: String,
    val messageBody: String
)

data class JobsResponse(
    val jobs: List<Job>
)

data class JobResultRequest(
    val job_id: String,
    val result: String,
    val error_message: String? = null
)

data class InboundSmsRequest(
    val senderNumber: String,
    val messageBody: String,
    val timestamp: Long
)

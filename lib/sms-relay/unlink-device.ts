type SmsRelayUnlinkRepository = {
  smsRelayDevice: {
    findFirst(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  smsRelayOutbox: { updateMany(args: any): Promise<{ count: number }> };
  deviceTunnelBinding: { update(args: any): Promise<any> };
  deviceTunnelSessionLease: { updateMany(args: any): Promise<{ count: number }> };
  whatsAppSessionAuthPlacement: { updateMany(args: any): Promise<{ count: number }> };
  whatsAppWebBridgeSession: { updateMany(args: any): Promise<{ count: number }> };
};

export type SmsRelayUnlinkResult = {
  found: boolean;
  canceledJobs: number;
  retainedForAudit: boolean;
};

/**
 * Revokes a device without deleting tunnel bindings retained by immutable
 * WhatsApp session-auth audit events.
 */
export async function unlinkSmsRelayDevice(
  repository: SmsRelayUnlinkRepository,
  input: { deviceId: string; locationId: string; now?: Date },
): Promise<SmsRelayUnlinkResult> {
  const now = input.now || new Date();
  const device = await repository.smsRelayDevice.findFirst({
    where: { id: input.deviceId, locationId: input.locationId },
    select: {
      id: true,
      tunnelBinding: { select: { id: true, sessionId: true } },
    },
  });
  if (!device) return { found: false, canceledJobs: 0, retainedForAudit: false };

  const canceled = await repository.smsRelayOutbox.updateMany({
    where: {
      deviceId: device.id,
      locationId: input.locationId,
      status: { in: ["pending", "processing", "failed"] },
    },
    data: {
      status: "cancelled",
      processedAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: "Device was unlinked by an administrator.",
    },
  });

  if (device.tunnelBinding) {
    await repository.deviceTunnelSessionLease.updateMany({
      where: { bindingId: device.tunnelBinding.id },
      data: { state: "expired", expiresAt: now },
    });
    await repository.whatsAppSessionAuthPlacement.updateMany({
      where: { bindingId: device.tunnelBinding.id },
      data: {
        state: "relink_required",
        recoveryStatus: "relink_required",
        lastErrorCode: "DEVICE_UNLINKED",
        gatewayNodeId: null,
        ownerInstanceId: null,
        operationId: null,
        operationStartedAt: null,
        operationDeadlineAt: null,
        lastDetachedAt: now,
      },
    });
    await repository.deviceTunnelBinding.update({
      where: { id: device.tunnelBinding.id },
      data: {
        status: "revoked",
        desiredState: "disabled",
        drainRequestedAt: now,
        gatewayNodeId: null,
        lastError: "Device was unlinked by an administrator.",
      },
    });
    await repository.whatsAppWebBridgeSession.updateMany({
      where: { id: device.tunnelBinding.sessionId, locationId: input.locationId },
      data: {
        status: "disconnected",
        egressMode: "server",
        phone: null,
        qrCode: null,
        lastReadyAt: null,
        lastSeenAt: now,
        isDefaultOutbound: false,
        lastError: null,
      },
    });
  }

  await repository.smsRelayDevice.update({
    where: { id: device.id },
    data: {
      status: "offline",
      paired: false,
      pairTokenHash: null,
      pairExpiresAt: null,
      pairAttemptCount: 0,
      deviceApiTokenHash: null,
      devicePushToken: null,
      tunnelPublicKey: null,
      tunnelCredentialVersion: { increment: 1 },
      tunnelRevokedAt: now,
      tunnelChallengeHash: null,
      tunnelChallengeExpiresAt: null,
      lastSeenAt: null,
    },
  });

  return {
    found: true,
    canceledJobs: canceled.count,
    retainedForAudit: Boolean(device.tunnelBinding),
  };
}

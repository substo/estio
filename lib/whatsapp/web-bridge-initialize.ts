export function didWhatsAppWebSessionReachReadyBeforeInitializeError(args: {
    ready: boolean;
    lastReadyAt: Date | null;
}) {
    return args.ready === true && args.lastReadyAt instanceof Date && Number.isFinite(args.lastReadyAt.getTime());
}

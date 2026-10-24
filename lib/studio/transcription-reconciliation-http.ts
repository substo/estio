import { studioCommandResponse } from "./command-http";
import { readReconciliationCommand, type ReconciliationCommand } from "./transcription-reconciliation-policy";
export function transcriptionReviewResponse(request: Request, deps: {
  profile(): Promise<{ origin: string } | null>; execute(command: ReconciliationCommand): Promise<unknown>;
}) { return studioCommandResponse(request, { ...deps, parse: readReconciliationCommand }); }

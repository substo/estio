export interface PolicyApprovalGate {
    approved: boolean;
    reviewRequired?: boolean;
}

export function shouldRequireHumanApproval(
    risk: string,
    policyResult?: PolicyApprovalGate | null
): boolean {
    if (risk === "high") return true;
    if (!policyResult) return false;
    if (!policyResult.approved) return true;
    return !!policyResult.reviewRequired;
}

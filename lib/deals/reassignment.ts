export type DealReassignmentRepository = {
    dealContext: {
        updateMany(args: {
            where: { locationId: string; assignedUserId: string; stage: { not: "CLOSED" } };
            data: { assignedUserId: string };
        }): Promise<{ count: number }>;
    };
};

export async function reassignActiveDealsWithinLocation(
    repository: DealReassignmentRepository,
    input: { locationId: string; sourceUserId: string; successorUserId: string },
) {
    if (!input.locationId || !input.sourceUserId || !input.successorUserId) throw new Error("Missing Deal reassignment identity");
    if (input.sourceUserId === input.successorUserId) throw new Error("Source and successor must differ");
    return repository.dealContext.updateMany({
        where: {
            locationId: input.locationId,
            assignedUserId: input.sourceUserId,
            stage: { not: "CLOSED" },
        },
        data: { assignedUserId: input.successorUserId },
    });
}

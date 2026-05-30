export type ConversationSearchQueryAnalysis = {
    normalizedQuery: string;
    queryDigits: string;
    phoneLikeQuery: boolean;
    structuredReferenceQuery: boolean;
};

export function analyzeConversationSearchQuery(query: string): ConversationSearchQueryAnalysis {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    const queryDigits = normalizedQuery.replace(/\D/g, "");
    const hasLetters = /[A-Za-z]/.test(normalizedQuery);
    const hasDigits = /\d/.test(normalizedQuery);

    return {
        normalizedQuery,
        queryDigits,
        phoneLikeQuery: queryDigits.length >= 4 && !hasLetters && /^[+\d\s().-]+$/.test(normalizedQuery),
        structuredReferenceQuery: hasLetters
            && hasDigits
            && normalizedQuery.length >= 3
            && normalizedQuery.length <= 32
            && /^[A-Za-z0-9._#-]+$/.test(normalizedQuery),
    };
}

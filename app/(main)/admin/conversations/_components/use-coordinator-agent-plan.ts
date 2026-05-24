import { useEffect, useState } from "react";
import {
    executeNextTaskAction,
    generatePlanAction,
    getAgentExecutions,
    getAgentPlan,
    getContactContext,
} from "../actions";

export interface AgentTask {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done' | 'failed';
    result?: string;
}

export interface ThoughtStep {
    step: number;
    description: string;
    conclusion: string;
}

interface ConversationUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCost: number;
}

interface UseCoordinatorAgentPlanOptions {
    conversationId: string;
    contactId: string;
    onSuggestionsGenerated?: (suggestions: string[]) => void;
    setContactContext: (value: any) => void;
    setRawTrace: (value: any) => void;
    setTraceTree: (value: any) => void;
    setReasoning: (value: string) => void;
    setError: (value: string | null) => void;
}

export function useCoordinatorAgentPlan({
    conversationId,
    contactId,
    onSuggestionsGenerated,
    setContactContext,
    setRawTrace,
    setTraceTree,
    setReasoning,
    setError,
}: UseCoordinatorAgentPlanOptions) {
    const [goal, setGoal] = useState("Qualify the lead and book a viewing");
    const [plan, setPlan] = useState<AgentTask[]>([]);
    const [planning, setPlanning] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [agentActions, setAgentActions] = useState<any[]>([]);
    const [thoughtSteps, setThoughtSteps] = useState<ThoughtStep[]>([]);
    const [, setConversationUsage] = useState<ConversationUsage>({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalCost: 0
    });

    useEffect(() => {
        // Reset state immediately when conversation changes
        setPlan([]);
        setReasoning("");
        setThoughtSteps([]);
        setAgentActions([]);
        setRawTrace(null);
        setTraceTree(null);
        setGoal("Qualify the lead and book a viewing");

        if (!conversationId) return;

        let cancelled = false;
        const fetchTimer = setTimeout(() => {
            if (cancelled) return;
            getAgentPlan(conversationId).then((res: any) => {
                if (cancelled) return;
                if (res) {
                    if (res.plan) setPlan(res.plan);
                    if (res.usage) setConversationUsage(res.usage);
                    // Handle legacy return where res IS the plan array (if any stale cache/code)
                    if (Array.isArray(res)) setPlan(res);
                }
            });

            // Pull latest execution summary to hydrate Mission Control context.
            getAgentExecutions(conversationId).then(history => {
                if (cancelled) return;
                if (history && history.length > 0) {
                    const latest = history[0];
                    if (latest?.thoughtSummary) setReasoning(latest.thoughtSummary);
                }
            });
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(fetchTimer);
        };
    }, [conversationId]);

    const handleGeneratePlan = async () => {
        setPlanning(true);
        setError(null);
        try {
            const res = await generatePlanAction(conversationId, contactId, goal);
            if (res.success && res.plan) {
                setPlan(res.plan);
                setReasoning(res.thought || "Plan generated.");
            } else {
                setError(res.error || "Failed to generate plan");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setPlanning(false);
        }
    };

    const handleExecuteNext = async () => {
        setExecuting(true);
        setAgentActions([]);
        setThoughtSteps([]);
        setRawTrace(null);
        try {
            const res = await executeNextTaskAction(conversationId, contactId);
            if (res.success) {
                // Update local plan state to reflect status change
                const updatedPlan = [...plan];
                const taskIndex = updatedPlan.findIndex(t => t.id === res.task.id);
                if (taskIndex >= 0) updatedPlan[taskIndex] = res.task;
                setPlan(updatedPlan);

                setReasoning(res.thoughtSummary || "Task executed.");
                setThoughtSteps(res.thoughtSteps || []);
                setAgentActions(res.actions || []);
                if ((res as any)?.suggestionQueued) {
                    onSuggestionsGenerated?.([]);
                }

                // Update usage stats if returned
                if (res.conversationUsage) {
                    setConversationUsage(res.conversationUsage);
                }

                // Store full trace for modal display
                setRawTrace({
                    timestamp: new Date().toISOString(),
                    task: res.task,
                    thoughtSummary: res.thoughtSummary,
                    thoughtSteps: res.thoughtSteps,
                    toolCalls: res.actions,
                    draftReply: res.draft,
                    usage: res.usage
                });

                // Refresh context
                getContactContext(contactId).then(setContactContext);
            } else {
                if (res.message === "All tasks completed!") {
                    setReasoning("All tasks are done! Great job.");
                } else {
                    setError(res.error || "Failed to execute task");
                }
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setExecuting(false);
        }
    };

    return {
        goal,
        setGoal,
        plan,
        setPlan,
        planning,
        executing,
        agentActions,
        thoughtSteps,
        handleGeneratePlan,
        handleExecuteNext,
    };
}

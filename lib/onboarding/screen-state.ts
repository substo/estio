import type { TopicView } from "./view";

/** The topic the conversation is on: research waiting for confirmation first, then the first topic with nothing yet. */
export const currentTopic = (topics: TopicView[]) => topics.find(t => t.status === "suggested") ?? topics.find(t => t.status === "empty") ?? null;
/** The timeline highlights the owner's choice, otherwise the conversation's topic, otherwise the first. */
export const activeTopic = (topics: TopicView[], selected: string | null) =>
  (selected && topics.some(t => t.id === selected) ? selected : null) ?? currentTopic(topics)?.id ?? topics[0]?.id ?? null;

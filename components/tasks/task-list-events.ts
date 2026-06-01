'use client';

import { useEffect } from 'react';

export const TASKS_MUTATED_EVENT = 'estio-tasks-mutated';

export function notifyTasksMutated() {
  window.dispatchEvent(new Event(TASKS_MUTATED_EVENT));
}

export function useTasksMutatedRefresh(onRefresh: () => void, debounceMs = 300) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleMutated = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onRefresh, debounceMs);
    };

    window.addEventListener(TASKS_MUTATED_EVENT, handleMutated);
    return () => {
      window.removeEventListener(TASKS_MUTATED_EVENT, handleMutated);
      if (timer) clearTimeout(timer);
    };
  }, [debounceMs, onRefresh]);
}

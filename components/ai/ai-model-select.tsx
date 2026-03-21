'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AiModelOption } from "@/components/ai/use-ai-model-catalog";

interface AiModelSelectProps {
    value: string;
    models: AiModelOption[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    triggerClassName?: string;
    itemClassName?: string;
    placeholder?: string;
}

export function AiModelSelect({
    value,
    models,
    onValueChange,
    disabled = false,
    triggerClassName,
    itemClassName,
    placeholder = "Select model",
}: AiModelSelectProps) {
    return (
        <Select value={value} onValueChange={onValueChange} disabled={disabled || models.length === 0}>
            <SelectTrigger className={triggerClassName}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {models.map((model) => (
                    <SelectItem key={model.value} value={model.value} className={itemClassName}>
                        {model.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}


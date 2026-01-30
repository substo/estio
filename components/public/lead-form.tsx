"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitLeadInquiry } from "@/app/(public-site)/actions";
import { useEffect, useRef } from "react";

// Simple UI components to avoid dependency issues if shcn/ui is not fully set up or to keep it self-contained
// You can replace these with your library components (e.g. from @/components/ui/...) if preferred.

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <button
            type="submit"
            disabled={pending}
            className="w-full font-bold py-3 rounded-md transition-opacity hover:opacity-90 text-white disabled:opacity-70"
            style={{ backgroundColor: 'var(--primary-brand)' }}
        >
            {pending ? "Sending..." : "Schedule Viewing"}
        </button>
    );
}

interface LeadFormProps {
    domain: string;
    propertyId: string;
}

const initialState = {
    success: false,
    message: "",
    errors: {}
};

export function LeadForm({ domain, propertyId }: LeadFormProps) {
    // Bind arguments to the server action
    const submitWithArgs = submitLeadInquiry.bind(null, domain, propertyId);
    const [state, action] = useActionState(submitWithArgs, initialState);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (state.message) {
            if (state.success) {
                // Clear form on success
                formRef.current?.reset();
            }
        }
    }, [state]);

    return (
        <form ref={formRef} action={action} className="space-y-3">
            <div>
                <input
                    name="name"
                    type="text"
                    placeholder="Full Name"
                    required
                    className="w-full p-2 border rounded-md"
                />
                {state.errors?.name && <p className="text-xs text-red-500 mt-1">{state.errors.name[0]}</p>}
            </div>

            <div>
                <input
                    name="email"
                    type="email"
                    placeholder="Email Address"
                    required
                    className="w-full p-2 border rounded-md"
                />
                {state.errors?.email && <p className="text-xs text-red-500 mt-1">{state.errors.email[0]}</p>}
            </div>

            <div>
                <input
                    name="phone"
                    type="tel"
                    placeholder="Phone Number"
                    className="w-full p-2 border rounded-md"
                />
            </div>

            <div>
                <textarea
                    name="message"
                    placeholder="I'm interested in this property..."
                    className="w-full p-2 border rounded-md h-24 resize-none"
                />
            </div>

            <SubmitButton />

            {state.message && (
                <div className={`p-3 rounded-md text-sm text-center font-medium ${state.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {state.message}
                </div>
            )}
        </form>
    );
}

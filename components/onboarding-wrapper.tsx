'use client';

import { useEffect, useState } from 'react';
import { OnboardingModal } from '@/components/onboarding-modal';

interface OnboardingWrapperProps {
    needsOnboarding: boolean;
    existingData?: {
        firstName: string;
        lastName: string;
        phone: string;
    };
}

export function OnboardingWrapper({ needsOnboarding, existingData }: OnboardingWrapperProps) {
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        // Only show modal after hydration to avoid SSR mismatch
        if (needsOnboarding) {
            setShowModal(true);
        }
    }, [needsOnboarding]);

    if (!showModal) return null;

    return <OnboardingModal existingData={existingData} />;
}

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, QrCode, XCircle } from 'lucide-react';
import { startWhatsAppVerification, checkWhatsAppVerification, cancelWhatsAppVerification } from '../verification-actions';
import { useToast } from '@/components/ui/use-toast';
import { useRouter } from 'next/navigation';

export function WhatsAppVerification() {
    const [isStarting, setIsStarting] = useState(false);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
    const { toast } = useToast();
    const router = useRouter();

    const startVerification = async () => {
        setIsStarting(true);
        try {
            const result = await startWhatsAppVerification();
            if (result.success && result.qrCode) {
                setQrCode(result.qrCode);
                setIsVerifying(true);
            } else {
                toast({
                    title: "Error",
                    description: result.error || "Failed to start verification",
                    variant: "destructive"
                });
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "Network error occurred",
                variant: "destructive"
            });
        } finally {
            setIsStarting(false);
        }
    };

    const cancelVerification = async () => {
        setIsVerifying(false);
        setQrCode(null);
        await cancelWhatsAppVerification();
    };

    // Polling for status
    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval>;

        if (isVerifying && qrCode) {
            intervalId = setInterval(async () => {
                const result = await checkWhatsAppVerification();

                if (result.success && result.phone) {
                    setVerifiedPhone(result.phone);
                    setIsVerifying(false); // Stop polling
                    setQrCode(null);

                    toast({
                        title: "Verified!",
                        description: `Phone connected: ${result.phone}`,
                        className: "bg-green-600 text-white border-none"
                    });

                    router.refresh();
                }
            }, 3000); // Check every 3 seconds
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isVerifying, qrCode, toast, router]);

    if (verifiedPhone) {
        return (
            <Card className="w-full border-green-200 bg-green-50/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700">
                        <CheckCircle2 className="h-5 w-5" />
                        WhatsApp Verified
                    </CardTitle>
                    <CardDescription>
                        Your phone number <strong>{verifiedPhone}</strong> has been successfully verified via WhatsApp.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <QrCode className="h-5 w-5" />
                    Verify with WhatsApp
                </CardTitle>
                <CardDescription>
                    Scan a QR code with your WhatsApp to verify your account ownerhip.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-4">

                {!isVerifying ? (
                    <Button onClick={startVerification} disabled={isStarting} variant="outline" className="w-full sm:w-auto">
                        {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isStarting ? "Starting..." : "Generate QR Code"}
                    </Button>
                ) : (
                    <div className="flex flex-col items-center space-y-4 w-full">
                        <div className="bg-white p-4 rounded-lg shadow-sm border">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={qrCode!} alt="Scan with WhatsApp" className="w-64 h-64 object-contain" />
                        </div>

                        <div className="text-center space-y-1">
                            <p className="font-medium text-sm">Open WhatsApp &gt; Settings &gt; Linked Devices</p>
                            <p className="text-xs text-muted-foreground animate-pulse">Waiting for scan...</p>
                        </div>

                        <Button variant="ghost" size="sm" onClick={cancelVerification} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                            <XCircle className="mr-2 h-4 w-4" />
                            Cancel
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

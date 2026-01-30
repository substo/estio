"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";

export default function ContactForm({ locationId, propertyId, primaryColor }: { locationId: string, propertyId: string, primaryColor?: string }) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsSubmitting(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            locationId,
            propertyId,
            name: formData.get("name"),
            email: formData.get("email"),
            phone: formData.get("phone"),
            message: formData.get("message"),
        };

        try {
            const res = await fetch("/api/widget/contacts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                toast.success("Message sent! We will contact you shortly.");
                (e.target as HTMLFormElement).reset();
            } else {
                toast.error("Failed to send message. Please try again.");
            }
        } catch (error) {
            toast.error("An error occurred.");
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 border p-6 rounded-lg bg-white shadow-sm">
            <h3 className="text-xl font-semibold mb-4">Contact Agent</h3>
            <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" required />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" name="message" defaultValue="I am interested in this property." />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full" style={{ backgroundColor: primaryColor }}>
                {isSubmitting ? "Sending..." : "Send Message"}
            </Button>
        </form>
    );
}

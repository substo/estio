"use client"

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Skeleton } from "./ui/skeleton";

export default function ModeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // After mounting, we have access to the theme
    useEffect(() => setMounted(true), []);

    if (!mounted) {
       return (
        <Skeleton className="w-9 h-9"/>
       )
    }

    return (
        <div>
            {resolvedTheme === "dark" ? (
                <Button variant="ghost" className="shrink-0 hover:bg-muted border-zinc-800 bg-background text-foreground" size="icon" onClick={() => setTheme("light")}>
                    <Sun className="w-5 h-5" />
                    <span className="sr-only">Switch to light mode</span>
                </Button>
            ) : (
                <Button variant="ghost" size="icon" className="shrink-0 hover:bg-muted border-zinc-100 bg-background text-foreground" onClick={() => setTheme("dark")}>
                    <Moon className="w-5 h-5" />
                    <span className="sr-only">Switch to dark mode</span>
                </Button>
            )}
        </div>
    );
}

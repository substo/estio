"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Home, Heart, Bookmark, ChevronDown, ChevronRight, Search, Building2, Plus, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
    NavigationMenu,
    NavigationMenuContent,
    NavigationMenuItem,
    NavigationMenuLink,
    NavigationMenuList,
    NavigationMenuTrigger,
    navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { SignInButton, UserButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { useHeaderStyle } from "./header-context";

export interface NavLink {
    label: string;
    href: string;
    type?: 'page' | 'custom' | 'category';
    children?: NavLink[];
}

interface PublicHeaderProps {
    domain: string;
    navLinks: NavLink[];
    primaryColor?: string;
    logo?: {
        url?: string;
        lightUrl?: string;
        iconUrl?: string;
        textTop?: string;
        textBottom?: string;
    };
    menuStyle?: "side" | "top";
    publicListingEnabled?: boolean;
    isTeamMember?: boolean;
}

export function PublicHeader({ domain, navLinks, primaryColor, logo, menuStyle = "side", publicListingEnabled = true, isTeamMember = false }: PublicHeaderProps) {
    const [scrolled, setScrolled] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const pathname = usePathname();
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Context Consumer
    const { headerStyle } = useHeaderStyle();

    useEffect(() => {
        setMounted(true);
    }, []);

    const isSolidHeaderPage =
        pathname.includes("/properties") ||
        // pathname.includes("/favorites") || // Removed to allow dynamic config
        pathname.includes("/sign-in") ||
        pathname.includes("/sign-up") ||
        headerStyle === "solid";
    const isTransparentHeader = !isSolidHeaderPage; // Explicitly transparent or default
    const isDarkMode = mounted && resolvedTheme === "dark";

    // --- Responsive Menu Logic ---
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768); // md breakpoint
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Force "side" style on mobile, regardless of admin setting
    const effectiveMenuStyle = isMobile ? "side" : menuStyle;


    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll);
        handleScroll();
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const links = navLinks.length > 0 ? navLinks : [
        { label: "Buy", href: "/properties/search?status=sale", type: 'custom' },
        { label: "Rent", href: "/properties/search?status=rent", type: 'custom' },
        { label: "New Developments", href: "/properties/search?type=development", type: 'custom' },
        { label: "About Us", href: "/about", type: 'page' },
    ] as NavLink[];

    const showDarkLogo = scrolled && !isDarkMode;
    const activeLogoUrl = showDarkLogo ? (logo?.url || logo?.lightUrl) : (logo?.lightUrl || logo?.url);

    // --- Helper to Render Nav Items ---
    const renderNavItems = (items: NavLink[]) => {
        return items.map((link, idx) => {
            if (link.type === 'category' && link.children && link.children.length > 0) {
                return (
                    <AccordionItem value={`item-${idx}`} key={idx} className="border-b-0">
                        <AccordionTrigger className="hover:no-underline py-3 px-2 text-lg font-heading font-bold text-gray-900 hover:text-primary hover:bg-gray-50 rounded-md transition-colors">
                            {link.label}
                        </AccordionTrigger>
                        <AccordionContent className="pb-2 pt-0">
                            <div className="flex flex-col pl-4 space-y-1 border-l-2 border-gray-100 ml-2 mt-1">
                                {link.children.map((child, cIdx) => (
                                    <Link
                                        key={cIdx}
                                        href={child.href}
                                        onClick={() => setSheetOpen(false)}
                                        className="block py-2 px-2 text-base font-medium text-gray-600 hover:text-primary transition-colors hover:translate-x-1"
                                        style={primaryColor ? { ':hover': { color: primaryColor } } as any : {}}
                                    >
                                        {child.label}
                                    </Link>
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                );
            }

            return (
                <Link
                    key={idx}
                    href={link.href}
                    onClick={() => setSheetOpen(false)}
                    className="block py-3 px-2 text-lg font-heading font-bold text-gray-900 hover:text-primary hover:bg-gray-50 rounded-md transition-colors border-b border-gray-50 last:border-0"
                    style={primaryColor ? { ':hover': { color: primaryColor } } as any : {}}
                >
                    {link.label}
                </Link>
            );
        });
    };

    // --- Helper to Render Horizontal Nav Items (Top Menu) ---
    const renderHorizontalNavItems = (items: NavLink[]) => {
        return (
            <NavigationMenu className="max-w-none">
                <NavigationMenuList>
                    {items.map((link, idx) => {
                        if (link.type === 'category' && link.children && link.children.length > 0) {
                            return (
                                <NavigationMenuItem key={idx}>
                                    <NavigationMenuTrigger
                                        className="bg-transparent text-xl font-heading font-bold text-gray-900 hover:text-primary hover:bg-transparent data-[state=open]:bg-transparent"
                                        style={primaryColor ? { ':hover': { color: primaryColor } } as any : {}}
                                    >
                                        {link.label}
                                    </NavigationMenuTrigger>
                                    <NavigationMenuContent>
                                        <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px] bg-white">
                                            {link.children.map((child, cIdx) => (
                                                <li key={cIdx}>
                                                    <NavigationMenuLink asChild>
                                                        <Link
                                                            href={child.href}
                                                            onClick={() => setSheetOpen(false)}
                                                            className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                                                        >
                                                            <div className="text-sm font-medium leading-none">{child.label}</div>
                                                        </Link>
                                                    </NavigationMenuLink>
                                                </li>
                                            ))}
                                        </ul>
                                    </NavigationMenuContent>
                                </NavigationMenuItem>
                            );
                        }

                        return (
                            <NavigationMenuItem key={idx}>
                                <Link href={link.href} legacyBehavior passHref>
                                    <NavigationMenuLink
                                        className={cn(navigationMenuTriggerStyle(), "bg-transparent text-xl font-heading font-bold text-gray-900 hover:text-primary hover:bg-transparent focus:bg-transparent")}
                                        onClick={() => setSheetOpen(false)}
                                        style={primaryColor ? { ':hover': { color: primaryColor } } as any : {}}
                                    >
                                        {link.label}
                                    </NavigationMenuLink>
                                </Link>
                            </NavigationMenuItem>
                        );
                    })}
                </NavigationMenuList>
            </NavigationMenu>
        );
    };

    const headerTextColor = scrolled ? "text-gray-900" : "text-white";

    return (
        <>
            <nav
                className={cn(
                    "fixed top-0 w-full z-50 transition-all duration-300 border-b",
                    scrolled
                        ? "bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-gray-200 dark:border-gray-800 shadow-sm py-2"
                        : (isSolidHeaderPage ? "bg-black border-black py-2" : "bg-transparent border-transparent py-4")
                )}
            >
                <div className="container mx-auto px-4 md:px-6">
                    <div className="flex items-center justify-between h-16">
                        {/* Brand Logo */}
                        <Link href="/" className="flex items-center gap-3 group z-50 relative">
                            {(logo?.url || logo?.lightUrl) && (
                                <img
                                    src={activeLogoUrl}
                                    alt={domain}
                                    className="h-12 w-auto object-contain transition-all bg-transparent"
                                />
                            )}

                            {(logo?.textTop || !(logo?.url || logo?.lightUrl)) && (
                                <>
                                    {!(logo?.url || logo?.lightUrl) && (
                                        <>
                                            {logo?.iconUrl ? (
                                                <img src={logo.iconUrl} alt="Icon" className="h-10 w-10 object-contain mr-1" />
                                            ) : (
                                                <div
                                                    className={cn(
                                                        "p-2 rounded-sm transition-colors",
                                                        scrolled ? "text-white" : "bg-white/10 backdrop-blur-sm group-hover:bg-primary text-white"
                                                    )}
                                                    style={scrolled && primaryColor ? { backgroundColor: primaryColor } : (!scrolled ? {} : { backgroundColor: 'transparent' })}
                                                >
                                                    <Home className="h-6 w-6 text-white" />
                                                </div>
                                            )}
                                        </>
                                    )}
                                    <div className="flex flex-col">
                                        <span
                                            className={cn(
                                                "font-heading text-xl font-extrabold tracking-tight leading-none",
                                                scrolled ? "text-primary" : "text-white"
                                            )}
                                            style={scrolled && primaryColor ? { color: primaryColor } : {}}
                                        >
                                            {(logo?.textTop || domain).toUpperCase()}
                                        </span>
                                        <span
                                            className={cn(
                                                "text-[0.55rem] font-bold uppercase tracking-[0.2em] leading-none mt-1",
                                                scrolled ? "text-gray-600" : "text-white/90"
                                            )}
                                        >
                                            {logo?.textBottom || "REAL ESTATE AGENCY"}
                                        </span>
                                    </div>
                                </>
                            )}
                        </Link>

                        {/* Right Side: Actions + Hamburger */}
                        <div className="flex items-center gap-4">

                            {/* Desktop: Show Search & List Your Property CTAs */}
                            <div className="hidden md:flex items-center gap-3">
                                <Link href="/properties/search">
                                    <Button
                                        variant="ghost"
                                        className={cn(
                                            "font-bold rounded-sm px-6 text-xs uppercase tracking-wider flex items-center gap-2 border transition-all",
                                            scrolled
                                                ? "border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400"
                                                : "border-white/40 text-white hover:bg-white/10 hover:border-white/60"
                                        )}
                                    >
                                        <Search className="h-4 w-4" />
                                        Search Properties
                                    </Button>
                                </Link>



                                {publicListingEnabled && (
                                    <>
                                        <SignedOut>
                                            <SignInButton mode="modal">
                                                <Button
                                                    variant={scrolled ? "default" : "secondary"}
                                                    className={cn(
                                                        "font-bold rounded-sm px-6 uppercase text-xs tracking-wider flex items-center gap-2",
                                                        !scrolled && "bg-white text-primary hover:bg-white/90"
                                                    )}
                                                    style={
                                                        scrolled && primaryColor
                                                            ? { backgroundColor: primaryColor, color: 'white' }
                                                            : (!scrolled && primaryColor ? { color: primaryColor } : {})
                                                    }
                                                >
                                                    <Plus className="h-4 w-4" />
                                                    List Your Property
                                                </Button>
                                            </SignInButton>
                                        </SignedOut>

                                        <SignedIn>
                                            <Link href="/properties/add">
                                                <Button
                                                    variant={scrolled ? "default" : "secondary"}
                                                    className={cn(
                                                        "font-bold rounded-sm px-6 uppercase text-xs tracking-wider flex items-center gap-2",
                                                        !scrolled && "bg-white text-primary hover:bg-white/90"
                                                    )}
                                                    style={
                                                        scrolled && primaryColor
                                                            ? { backgroundColor: primaryColor, color: 'white' }
                                                            : (!scrolled && primaryColor ? { color: primaryColor } : {})
                                                    }
                                                >
                                                    <Plus className="h-4 w-4" />
                                                    List Your Property
                                                </Button>
                                            </Link>
                                        </SignedIn>
                                    </>
                                )}
                            </div>

                            {/* Signed In Icons (Favorites etc) - Visible on Desktop/Mobile */}
                            <SignedIn>
                                <div className="hidden md:flex items-center gap-3 mr-2">
                                    {isTeamMember && (
                                        <Link
                                            href="/admin"
                                            className={cn("transition-colors hover:text-primary font-bold flex items-center gap-2", headerTextColor)}
                                            title="Admin Dashboard"
                                        >
                                            <LayoutDashboard className="h-4 w-4" />
                                            <span className="text-xs uppercase tracking-wider">Dashboard</span>
                                        </Link>
                                    )}

                                    {publicListingEnabled && (
                                        <Link
                                            href="/submissions"
                                            className={cn("transition-colors hover:text-primary", headerTextColor)}
                                            title="My Submissions"
                                        >
                                            <Building2 className="h-6 w-6" />
                                        </Link>
                                    )}
                                    <Link
                                        href="/favorites"
                                        className={cn("transition-colors hover:text-primary", headerTextColor)}
                                        title="My Favorites"
                                    >
                                        <Heart className="h-6 w-6" />
                                    </Link>
                                </div>
                            </SignedIn>

                            {/* Hamburger Menu Trigger */}
                            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                                <SheetTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "h-12 w-12 rounded-full hover:bg-white/20 transition-all",
                                            headerTextColor
                                        )}
                                    >
                                        <Menu className="h-7 w-7" />
                                        <span className="sr-only">Toggle menu</span>
                                    </Button>
                                </SheetTrigger>
                                <SheetContent
                                    side={effectiveMenuStyle === "top" ? "top" : "right"}
                                    className={cn(
                                        "p-0 border-gray-100 shadow-2xl bg-white/98 backdrop-blur-xl transition-all duration-500 ease-in-out",
                                        effectiveMenuStyle === "top" ? "w-full h-auto max-h-[85vh] border-b" : "w-full sm:w-[400px] h-full border-l"
                                    )}
                                >
                                    <div className="flex flex-col h-full">

                                        {/* Header inside Sheet */}
                                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                                            <span className="text-sm font-bold uppercase tracking-widest text-gray-500">Menu</span>
                                            {/* SheetClose is handled by the default close button, but we can add branding here if needed */}
                                        </div>

                                        {/* Scrollable Content */}
                                        <div className="flex-1 overflow-y-auto p-6">
                                            {effectiveMenuStyle === "top" ? (
                                                <div className="flex flex-col items-center justify-center py-8 space-y-8 w-full">
                                                    <div className="flex w-full justify-center">
                                                        {renderHorizontalNavItems(links)}
                                                    </div>

                                                    {/* Call to Action in Horizontal Menu */}
                                                    <div className="flex items-center gap-6 mt-8">
                                                        <Link href="/properties/search" onClick={() => setSheetOpen(false)}>
                                                            <Button
                                                                variant="outline"
                                                                className="rounded-sm font-bold tracking-wider px-8 py-6 text-xs uppercase flex items-center gap-2 border-gray-300 hover:bg-gray-50"
                                                            >
                                                                <Search className="h-4 w-4" />
                                                                Search Properties
                                                            </Button>
                                                        </Link>


                                                        {publicListingEnabled && (
                                                            <>
                                                                <SignedOut>
                                                                    <SignInButton mode="modal">
                                                                        <Button
                                                                            className="rounded-sm font-bold uppercase tracking-wider px-8 py-6 text-sm flex items-center gap-2"
                                                                            style={primaryColor ? { backgroundColor: primaryColor } : {}}
                                                                        >
                                                                            <Plus className="h-4 w-4" />
                                                                            List Your Property
                                                                        </Button>
                                                                    </SignInButton>
                                                                </SignedOut>

                                                                <SignedIn>
                                                                    <Link href="/properties/add" onClick={() => setSheetOpen(false)}>
                                                                        <Button
                                                                            className="rounded-sm font-bold uppercase tracking-wider px-8 py-6 text-sm flex items-center gap-2"
                                                                            style={primaryColor ? { backgroundColor: primaryColor } : {}}
                                                                        >
                                                                            <Plus className="h-4 w-4" />
                                                                            List Your Property
                                                                        </Button>
                                                                    </Link>
                                                                </SignedIn>
                                                            </>
                                                        )}

                                                        <SignedOut>
                                                            <SignInButton mode="modal">
                                                                <Button variant="outline" className="py-6 px-8 text-sm uppercase tracking-wider font-bold">
                                                                    Log In
                                                                </Button>
                                                            </SignInButton>
                                                        </SignedOut>

                                                        <SignedIn>
                                                            <div className="flex items-center gap-4">
                                                                <UserButton afterSignOutUrl="/"
                                                                    appearance={{ elements: { avatarBox: "h-10 w-10" } }}
                                                                />
                                                                <span className="text-sm font-bold text-gray-900">My Account</span>
                                                            </div>
                                                        </SignedIn>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <Accordion type="multiple" className="w-full space-y-1">
                                                        {renderNavItems(links)}
                                                    </Accordion>

                                                    {/* Button Group: Visible on Mobile, Hidden on Desktop */}
                                                    <div className="flex flex-col gap-4 mt-8 md:hidden">
                                                        <Link href="/properties/search" className="block" onClick={() => setSheetOpen(false)}>
                                                            <Button
                                                                variant="outline"
                                                                className="w-full rounded-sm font-bold tracking-wider py-6 text-xs uppercase flex items-center justify-center gap-2 border-gray-300 hover:bg-gray-50"
                                                            >
                                                                <Search className="h-4 w-4" />
                                                                Search Properties
                                                            </Button>
                                                        </Link>


                                                        {publicListingEnabled && (
                                                            <>
                                                                <SignedOut>
                                                                    <SignInButton mode="modal">
                                                                        <Button
                                                                            className="w-full rounded-sm font-bold uppercase tracking-wider py-6 text-xs flex items-center justify-center gap-2"
                                                                            style={primaryColor ? { backgroundColor: primaryColor } : {}}
                                                                        >
                                                                            <Plus className="h-4 w-4" />
                                                                            List Your Property
                                                                        </Button>
                                                                    </SignInButton>
                                                                </SignedOut>

                                                                <SignedIn>
                                                                    <Link href="/properties/add" onClick={() => setSheetOpen(false)}>
                                                                        <Button
                                                                            className="w-full rounded-sm font-bold uppercase tracking-wider py-6 text-xs flex items-center justify-center gap-2"
                                                                            style={primaryColor ? { backgroundColor: primaryColor } : {}}
                                                                        >
                                                                            <Plus className="h-4 w-4" />
                                                                            List Your Property
                                                                        </Button>
                                                                    </Link>
                                                                </SignedIn>
                                                            </>
                                                        )}
                                                    </div>

                                                    {/* Profile / Log In Section: Integrated into list */}
                                                    <div className="flex flex-col">
                                                        <SignedOut>
                                                            <SignInButton mode="modal">
                                                                <button
                                                                    className="block w-full text-left py-3 px-2 text-lg font-heading font-bold text-gray-900 hover:text-primary hover:bg-gray-50 rounded-md transition-colors border-b border-gray-50 last:border-0"
                                                                    onClick={() => setSheetOpen(false)}
                                                                >
                                                                    Log In / Sign Up
                                                                </button>
                                                            </SignInButton>
                                                        </SignedOut>

                                                        <SignedIn>
                                                            {/* My Account Header */}
                                                            <div className="py-3 px-2 border-b border-gray-50">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-lg font-heading font-bold text-gray-900">My Account</span>
                                                                    <UserButton
                                                                        afterSignOutUrl="/"
                                                                        appearance={{ elements: { avatarBox: "h-8 w-8" } }}
                                                                    />
                                                                </div>
                                                                {/* Sublinks */}
                                                                <div className="flex flex-col mt-2 pl-2 space-y-2">
                                                                    {isTeamMember && (
                                                                        <Link
                                                                            href="/admin"
                                                                            className="block py-2 px-2 text-base font-medium text-gray-600 hover:text-primary transition-colors hover:translate-x-1"
                                                                            onClick={() => setSheetOpen(false)}
                                                                        >
                                                                            Admin Dashboard
                                                                        </Link>
                                                                    )}
                                                                    {publicListingEnabled && (
                                                                        <Link
                                                                            href="/submissions"
                                                                            className="block py-2 px-2 text-base font-medium text-gray-600 hover:text-primary transition-colors hover:translate-x-1"
                                                                            onClick={() => setSheetOpen(false)}
                                                                        >
                                                                            My Submissions
                                                                        </Link>
                                                                    )}
                                                                    <Link
                                                                        href="/favorites"
                                                                        className="block py-2 px-2 text-base font-medium text-gray-600 hover:text-primary transition-colors hover:translate-x-1"
                                                                        onClick={() => setSheetOpen(false)}
                                                                    >
                                                                        My Favorites
                                                                    </Link>
                                                                </div>
                                                            </div>
                                                        </SignedIn>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* Footer inside Sheet */}
                                        <div className="p-6 bg-gray-50 border-t border-gray-100 text-center">
                                            <p className="text-xs text-gray-400">
                                                &copy; {new Date().getFullYear()} {domain}. All rights reserved.
                                            </p>
                                        </div>
                                    </div>
                                </SheetContent >
                            </Sheet >
                        </div >
                    </div >
                </div >
            </nav >

            {/* TOP MENU IMPLEMENTATION (Slide from Under) */}
            {/* Rendered outside the fixed nav but controlled by it. 
                We use fixed positioning to place it relative to the viewport, just like the nav. 
                z-40 ensures it is BEHIND the z-50 nav. 
            */}
            {
                effectiveMenuStyle === "top" && (
                    <div
                        className={cn(
                            "fixed left-0 right-0 bg-white/98 backdrop-blur-xl border-b shadow-lg transition-all duration-500 ease-in-out z-40 overflow-hidden",
                            sheetOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none"
                        )}
                        style={{
                            // Dynamic padding based on header state
                            paddingTop: scrolled ? "80px" : "96px", // 5rem vs 6rem approx
                            top: 0
                        }}
                    >
                        <div className="container mx-auto px-4 pb-8 pt-4">
                            <div className="flex flex-col items-center justify-center space-y-8 w-full">
                                <div className="flex w-full justify-center">
                                    {renderHorizontalNavItems(links)}
                                </div>

                                {/* Call to Action in Horizontal Menu - Hide Buttons on Desktop */}
                                <div className="flex items-center gap-6 mt-4">
                                    <div className="flex items-center gap-6 md:hidden">
                                        {publicListingEnabled && (
                                            <>
                                                <SignedOut>
                                                    <SignInButton mode="modal">
                                                        <Button
                                                            className="rounded-sm font-bold uppercase tracking-wider px-8 py-6 text-xs flex items-center gap-2"
                                                            onClick={() => setSheetOpen(false)} // Close on click
                                                            style={primaryColor ? { backgroundColor: primaryColor } : {}}
                                                        >
                                                            <Plus className="h-4 w-4" />
                                                            List Your Property
                                                        </Button>
                                                    </SignInButton>
                                                </SignedOut>

                                                <SignedIn>
                                                    <Link href="/properties/add" onClick={() => setSheetOpen(false)}>
                                                        <Button
                                                            className="rounded-sm font-bold uppercase tracking-wider px-8 py-6 text-xs flex items-center gap-2"
                                                            style={primaryColor ? { backgroundColor: primaryColor } : {}}
                                                        >
                                                            <Plus className="h-4 w-4" />
                                                            List Your Property
                                                        </Button>
                                                    </Link>
                                                </SignedIn>
                                            </>
                                        )}
                                    </div>

                                    <SignedOut>
                                        <SignInButton mode="modal">
                                            <Button variant="outline" className="py-6 px-8 text-sm uppercase tracking-wider font-bold">
                                                Log In
                                            </Button>
                                        </SignInButton>
                                    </SignedOut>

                                    <SignedIn>
                                        <div className="flex items-center gap-4">
                                            <UserButton afterSignOutUrl="/"
                                                appearance={{ elements: { avatarBox: "h-10 w-10" } }}
                                            />
                                            <span className="text-sm font-bold text-gray-900">My Account</span>
                                        </div>
                                    </SignedIn>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {isSolidHeaderPage && <div className="h-20" />}
        </>
    );
}

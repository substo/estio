"use client";

import Link from "next/link";
import { Facebook, Instagram, Linkedin, MapPin, Phone, Mail, Home, Smartphone, Twitter, Youtube, Globe, Link as LinkIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface PublicFooterProps {
    siteConfig: any; // Using any to handle the flexible JSON structure safely
    primaryColor?: string;
}

export function PublicFooter({ siteConfig, primaryColor }: PublicFooterProps) {
    const currentYear = new Date().getFullYear();
    // Default to "Real Estate" if name is missing
    const locationName = siteConfig?.location?.name || "Real Estate";

    // Parse Footer Links or use specific defaults matching the image/demo
    const footerLinks = siteConfig?.footerLinks ? (
        Array.isArray(siteConfig.footerLinks) ? siteConfig.footerLinks : []
    ) : [
        { label: "Residential Sales", href: "/properties/search?status=sale" },
        { label: "Luxury Rentals", href: "/properties/search?status=rent" },
        { label: "Commercial", href: "/properties/search?type=Commercial" },
        { label: "New Projects", href: "/properties/search?status=sale" },
    ];

    const socialLinks = siteConfig?.socialLinks ? (
        Array.isArray(siteConfig.socialLinks) ? siteConfig.socialLinks : []
    ) : [];

    const getSocialIcon = (platform: string) => {
        switch (platform?.toLowerCase()) {
            case 'facebook': return Facebook;
            case 'instagram': return Instagram;
            case 'linkedin': return Linkedin;
            case 'twitter': return Twitter;
            case 'youtube': return Youtube;
            case 'whatsapp': return Phone;
            case 'tiktok': return Globe; // Fallback or use specific if available
            case 'pinterest': return LinkIcon;
            default: return LinkIcon;
        }
    };

    // Placeholder Contact Info
    const contactInfo = {
        address: siteConfig?.contactInfo?.address || "123 Makariou Avenue, Limassol 3030, Cyprus",
        mapsLink: siteConfig?.contactInfo?.mapsLink || "#",
        mapsLinkTitle: siteConfig?.contactInfo?.mapsLinkTitle || "",
        mobile: siteConfig?.contactInfo?.mobile || siteConfig?.contactInfo?.phone || "+357 99 123 456",
        landline: siteConfig?.contactInfo?.landline || "+357 25 123 456",
        email: siteConfig?.contactInfo?.email || "info@downtowncyprus.com",
    };

    // Use specific provided color or fallback to a hardcoded "Deep Red" to simulate the design if primaryColor is missing
    // But ideally we use the passed primaryColor.
    const bgColor = primaryColor || '#B91C1C'; // Fallback to red-700 like color if needed

    const theme = siteConfig?.theme as any;
    const brandName = theme?.logo?.textTop || locationName;
    const brandTagline = theme?.logo?.textBottom || "REAL ESTATE AGENCY";

    return (
        <footer
            className="pt-20 pb-10 mt-auto"
            style={{
                backgroundColor: bgColor,
                color: 'white'
            }}
        >
            <div className="container mx-auto px-4 md:px-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">

                    {/* Brand */}
                    <div className="space-y-6">
                        {(theme?.logo?.lightUrl || theme?.logo?.url) ? (
                            // IMAGE LOGO MODE
                            <div className="flex items-center">
                                <img
                                    src={theme.logo.lightUrl || theme.logo.url}
                                    alt={brandName}
                                    className="h-12 w-auto object-contain brightness-0 invert"
                                    style={{
                                        // If it's the light URL (white), don't invert. If it's standard URL (dark), invert to make it white?
                                        // Safest is to rely on user uploading correct "Light Logo" for dark backgrounds.
                                        // But if only 'url' (dark) is present, we might want to force brightness-0 invert to make it white on the colored footer.
                                        filter: theme.logo.lightUrl ? 'none' : 'brightness(0) invert(1)'
                                    }}
                                />
                            </div>
                        ) : (
                            // TEXT + ICON MODE (Fallback)
                            <div className="flex items-center gap-3">
                                {theme?.logo?.iconUrl ? (
                                    <div className="flex items-center justify-center max-w-[48px] max-h-[48px]">
                                        <img
                                            src={theme.logo.iconUrl}
                                            alt="Icon"
                                            className="w-10 h-10 object-contain"
                                        />
                                    </div>
                                ) : (
                                    <div className="bg-white p-2 rounded-sm max-w-[48px] max-h-[48px] flex items-center justify-center">
                                        <span className="h-6 w-6 flex items-center justify-center font-bold" style={{ color: bgColor }}>
                                            <Home className="h-6 w-6" />
                                        </span>
                                    </div>
                                )}
                                <div className="flex flex-col">
                                    <span className="font-heading text-xl font-extrabold tracking-tight leading-none text-white uppercase">
                                        {brandName}
                                    </span>
                                    <span className="text-[0.55rem] font-bold uppercase tracking-[0.2em] leading-none mt-1 text-white/80">
                                        {brandTagline}
                                    </span>
                                </div>
                            </div>
                        )}
                        <p className="text-white/80 text-sm leading-relaxed font-medium max-w-xs whitespace-pre-wrap">
                            {siteConfig?.footerBio || "Your trusted partner in real estate. We bring professionalism and local expertise to every transaction."}
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h3 className="font-heading font-bold text-lg mb-6">Properties</h3>
                        <ul className="space-y-4 text-sm font-medium text-white/80">
                            {footerLinks.map((link: any, idx: number) => (
                                <li key={idx}>
                                    <Link
                                        href={link.href || '#'}
                                        className="hover:text-white transition-colors flex items-center gap-2"
                                    >
                                        <span className="w-1 h-1 bg-white/50 rounded-full"></span>
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Contact */}
                    <div>
                        <h3 className="font-heading font-bold text-lg mb-6">Contact</h3>
                        <ul className="space-y-4 text-sm font-medium text-white/80">
                            <li className="flex items-start gap-4">
                                <MapPin className="h-5 w-5 text-white shrink-0 mt-0.5" />
                                {contactInfo.mapsLink && contactInfo.mapsLink !== "#" ? (
                                    <div className="flex flex-col">
                                        {contactInfo.mapsLinkTitle ? (
                                            <a
                                                href={contactInfo.mapsLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="group hover:text-white transition-colors flex flex-col"
                                                title={contactInfo.mapsLinkTitle}
                                            >
                                                <span className="font-bold text-white">{contactInfo.mapsLinkTitle}</span>
                                                <span className="text-white/80 mt-1 group-hover:text-white transition-colors">{contactInfo.address}</span>
                                            </a>
                                        ) : (
                                            <a href={contactInfo.mapsLink} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                                                {contactInfo.address}
                                            </a>
                                        )}
                                    </div>
                                ) : (
                                    <span>{contactInfo.address}</span>
                                )}
                            </li>
                            {contactInfo.mobile && (
                                <li className="flex items-center gap-4">
                                    <Smartphone className="h-5 w-5 text-white shrink-0" />
                                    <a href={`tel:${contactInfo.mobile.replace(/[^0-9+]/g, '')}`} className="hover:text-white transition-colors">
                                        {contactInfo.mobile}
                                    </a>
                                </li>
                            )}
                            {contactInfo.landline && (
                                <li className="flex items-center gap-4">
                                    <Phone className="h-5 w-5 text-white shrink-0" />
                                    <a href={`tel:${contactInfo.landline.replace(/[^0-9+]/g, '')}`} className="hover:text-white transition-colors">
                                        {contactInfo.landline}
                                    </a>
                                </li>
                            )}
                            <li className="flex items-center gap-4">
                                <Mail className="h-5 w-5 text-white shrink-0" />
                                <a href={`mailto:${contactInfo.email}`} className="hover:text-white transition-colors">
                                    {contactInfo.email}
                                </a>
                            </li>
                        </ul>
                    </div>

                    {/* Newsletter */}
                    <div>
                        <h3 className="font-heading font-bold text-lg mb-6">Stay Connected</h3>
                        <p className="text-sm font-medium text-white/80 mb-4">
                            Market insights and exclusive listings delivered to your inbox.
                        </p>
                        <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
                            <Input
                                type="email"
                                placeholder="Email Address"
                                className="bg-white/10 border border-white/20 px-4 py-3 text-sm w-full focus:outline-none focus:border-white focus:bg-white/20 text-white placeholder:text-white/50 rounded-sm transition-all h-auto"
                            />
                            <Button
                                type="submit"
                                className="bg-white px-4 py-3 text-sm font-bold uppercase tracking-wider hover:bg-white/90 transition-colors rounded-sm h-auto"
                                style={{ color: bgColor }}
                            >
                                Subscribe
                            </Button>
                        </form>
                    </div>
                </div>

                <div className="border-t border-white/20 pt-8 flex flex-col gap-6 text-xs text-white/60">
                    <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <p className="font-medium">
                                    &copy; {currentYear} {brandName}. All rights reserved.
                                </p>
                            </div>

                            {/* Legal Menu */}
                            {siteConfig?.legalLinks && Array.isArray(siteConfig.legalLinks) && siteConfig.legalLinks.length > 0 && (
                                <ul className="flex flex-wrap gap-4">
                                    {siteConfig.legalLinks.map((link: any, idx: number) => (
                                        <li key={idx}>
                                            <Link
                                                href={link.href}
                                                className="hover:text-white transition-colors underline decoration-white/30 underline-offset-4"
                                            >
                                                {link.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="flex flex-col items-center md:items-end gap-4">
                            {/* Social Icons */}
                            <div className="flex space-x-6">
                                {socialLinks.length > 0 ? (
                                    socialLinks.map((link: any, idx: number) => {
                                        const Icon = getSocialIcon(link.platform);
                                        return (
                                            <a
                                                key={idx}
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-white/80 hover:text-white transition-colors"
                                                aria-label={link.platform}
                                            >
                                                <Icon className="h-5 w-5" />
                                            </a>
                                        );
                                    })
                                ) : (
                                    <>
                                        <a href="#" className="text-white/80 hover:text-white transition-colors"><Instagram className="h-5 w-5" /></a>
                                        <a href="#" className="text-white/80 hover:text-white transition-colors"><Facebook className="h-5 w-5" /></a>
                                        <a href="#" className="text-white/80 hover:text-white transition-colors"><Linkedin className="h-5 w-5" /></a>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Full Width Disclaimer */}
                    {siteConfig?.footerDisclaimer && (
                        <div className="text-white/40 w-full whitespace-pre-wrap border-t border-white/10 pt-4 mt-2">
                            {siteConfig.footerDisclaimer}
                        </div>
                    )}
                </div>
            </div>
        </footer>
    );
}

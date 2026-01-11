import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Plus, Pencil, Trash, ExternalLink } from "lucide-react";
import { deletePage } from "@/app/(main)/admin/content/actions";

export default async function PagesListPage() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) return null;

    const pages = await db.contentPage.findMany({
        where: { locationId: orgId },
        orderBy: { updatedAt: 'desc' }
    });

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: orgId },
        select: { domain: true }
    });

    const domain = siteConfig?.domain || "your-domain.com";
    const protocol = domain.includes("localhost") ? "http" : "https";
    const port = domain.includes("localhost") ? ":3000" : "";

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Static Pages</h1>
                <Link href="/admin/content/pages/new">
                    <Button><Plus className="w-4 h-4 mr-2" /> Create Page</Button>
                </Link>
            </div>

            <div className="border rounded-md bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Title</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {/* Virtual Home Page Row */}
                        <TableRow className="bg-slate-50">
                            <TableCell className="font-medium">
                                <span className="flex items-center gap-2">
                                    Home
                                    <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full uppercase font-bold tracking-wider">System</span>
                                </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">/</TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 rounded-full text-xs bg-green-100 text-green-700`}>
                                    Published
                                </span>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                                <Link href={`/admin/content/home`}>
                                    <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
                                </Link>
                                <a href={`${protocol}://${domain}${port}/`} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" title="View Live"><ExternalLink className="w-4 h-4" /></Button>
                                </a>
                                {/* No Delete Action for Home */}
                                <Button variant="ghost" size="icon" disabled className="opacity-20"><Trash className="w-4 h-4" /></Button>
                            </TableCell>
                        </TableRow>

                        {/* Virtual Favorites Page Row */}
                        <TableRow className="bg-slate-50">
                            <TableCell className="font-medium">
                                <span className="flex items-center gap-2">
                                    Favorites
                                    <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full uppercase font-bold tracking-wider">System</span>
                                </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">/favorites</TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 rounded-full text-xs bg-green-100 text-green-700`}>
                                    Published
                                </span>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                                <Link href={`/admin/content/favorites`}>
                                    <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
                                </Link>
                                <a href={`${protocol}://${domain}${port}/favorites`} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" title="View Live"><ExternalLink className="w-4 h-4" /></Button>
                                </a>
                                {/* No Delete Action for Favorites */}
                                <Button variant="ghost" size="icon" disabled className="opacity-20"><Trash className="w-4 h-4" /></Button>
                            </TableCell>
                        </TableRow>

                        {/* Virtual Submissions Page Row */}
                        <TableRow className="bg-slate-50">
                            <TableCell className="font-medium">
                                <span className="flex items-center gap-2">
                                    Submissions
                                    <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full uppercase font-bold tracking-wider">System</span>
                                </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">/submissions</TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 rounded-full text-xs bg-green-100 text-green-700`}>
                                    Published
                                </span>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                                <Link href={`/admin/content/submissions`}>
                                    <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
                                </Link>
                                <a href={`${protocol}://${domain}${port}/submissions`} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" title="View Live"><ExternalLink className="w-4 h-4" /></Button>
                                </a>
                                {/* No Delete Action for Submissions */}
                                <Button variant="ghost" size="icon" disabled className="opacity-20"><Trash className="w-4 h-4" /></Button>
                            </TableCell>
                        </TableRow>

                        {/* Virtual Search Page Row */}
                        <TableRow className="bg-slate-50">
                            <TableCell className="font-medium">
                                <span className="flex items-center gap-2">
                                    Search
                                    <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full uppercase font-bold tracking-wider">System</span>
                                </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">/properties/search</TableCell>
                            <TableCell>
                                <span className={`px-2 py-1 rounded-full text-xs bg-green-100 text-green-700`}>
                                    Published
                                </span>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                                <Link href={`/admin/content/search`}>
                                    <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
                                </Link>
                                <a href={`${protocol}://${domain}${port}/properties/search`} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" title="View Live"><ExternalLink className="w-4 h-4" /></Button>
                                </a>
                                {/* No Delete Action for Search */}
                                <Button variant="ghost" size="icon" disabled className="opacity-20"><Trash className="w-4 h-4" /></Button>
                            </TableCell>
                        </TableRow>

                        {pages.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                    No custom pages found. Create one to get started.
                                </TableCell>
                            </TableRow>
                        )}
                        {pages.map((page) => (
                            <TableRow key={page.id}>
                                <TableCell className="font-medium">{page.title}</TableCell>
                                <TableCell className="text-muted-foreground">/{page.slug}</TableCell>
                                <TableCell>
                                    <span className={`px-2 py-1 rounded-full text-xs ${page.published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                        {page.published ? 'Published' : 'Draft'}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                    <Link href={`/admin/content/pages/${page.id}`}>
                                        <Button variant="ghost" size="icon"><Pencil className="w-4 h-4" /></Button>
                                    </Link>
                                    {page.published && (
                                        <a href={`${protocol}://${domain}${port}/${page.slug}`} target="_blank" rel="noopener noreferrer">
                                            <Button variant="ghost" size="icon" title="View Live"><ExternalLink className="w-4 h-4" /></Button>
                                        </a>
                                    )}
                                    <form action={async () => {
                                        "use server";
                                        await deletePage(page.id);
                                    }} className="inline">
                                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash className="w-4 h-4" /></Button>
                                    </form>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

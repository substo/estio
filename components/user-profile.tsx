import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import config from "@/config"
import { SignOutButton, useUser } from "@clerk/nextjs"
import { LogOut, User } from "lucide-react"
import Link from "next/link"

export function UserProfile() {
    if (!config?.auth?.enabled) {
        return null;
    }

    return <UserProfileContent />
}

function UserProfileContent() {
    const { user } = useUser();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild className="w-[2.25rem] h-[2.25rem]">
                <Avatar >
                    <AvatarImage src={user?.imageUrl} alt="User Profile" />
                    <AvatarFallback></AvatarFallback>
                </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>My profile</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <Link href="/admin/user-profile">
                        <DropdownMenuItem>
                            <User className="mr-2 h-4 w-4" />
                            <span>My profile</span>
                            <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                        </DropdownMenuItem>
                    </Link>
                </DropdownMenuGroup>
                <SignOutButton>
                    <DropdownMenuItem>
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Log out</span>
                        <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
                    </DropdownMenuItem>
                </SignOutButton>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

import config from "@/config";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { UserProfileForm } from "../_components/user-profile-form";

const UserProfilePage = async () => {
    if (!config?.auth?.enabled) {
        redirect('/admin');
    }

    const user = await currentUser();
    if (!user) {
        redirect('/sign-in');
    }

    const dbUser = await db.user.findUnique({
        where: { clerkId: user.id },
        select: {
            firstName: true,
            lastName: true,
            timeZone: true,
        }
    });

    const primaryEmail = user.emailAddresses.find(
        (email) => email.id === user.primaryEmailAddressId
    )?.emailAddress || user.emailAddresses[0]?.emailAddress || '';

    const initialData = {
        firstName: dbUser?.firstName || '',
        lastName: dbUser?.lastName || '',
        timeZone: dbUser?.timeZone || '',
    };

    return (
        <main className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
            <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My profile</h1>
                <p className="text-muted-foreground">Manage your personal details and sign-in security.</p>
            </div>
            <UserProfileForm initialData={initialData} primaryEmail={primaryEmail} />
        </main>
    )
}


export default UserProfilePage;

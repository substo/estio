import config from "@/config";
import { UserProfile } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { UserProfileForm } from "../_components/user-profile-form";
import { WhatsAppVerification } from "../_components/whatsapp-verification";

const UserProfilePage = async () => {
    if (!config?.auth?.enabled) {
        redirect('/admin');
    }

    const user = await currentUser();

    // Fetch local user details to populate the form
    // We assume the user exists in DB properly via sync, but fallback gracefully
    let dbUser = null;
    if (user) {
        dbUser = await db.user.findUnique({
            where: { clerkId: user.id },
            select: {
                firstName: true,
                lastName: true,
                phone: true,
                email: true
            }
        });
    }

    const initialData = {
        firstName: dbUser?.firstName || user?.firstName || '',
        lastName: dbUser?.lastName || user?.lastName || '',
        phone: dbUser?.phone || '',
        email: dbUser?.email || user?.emailAddresses[0]?.emailAddress || ''
    };

    return (
        <div className="flex flex-col items-center justify-start p-6 space-y-8 w-full max-w-5xl mx-auto">
            <div className="w-full space-y-6">
                <UserProfileForm initialData={initialData} />
                <WhatsAppVerification />
            </div>

            <div className="w-full flex justify-center">
                <UserProfile path="/admin/user-profile" routing="path" />
            </div>
        </div>
    )
}


export default UserProfilePage;
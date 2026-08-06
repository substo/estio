import config from "@/config";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

const UserProfilePage = async () => {
    if (!config?.auth?.enabled) {
        redirect('/admin');
    }

    const { userId } = await auth();
    if (!userId) {
        redirect('/sign-in');
    }

    redirect('/admin/user-profile');
}


export default UserProfilePage;

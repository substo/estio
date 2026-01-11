import { getSiteConfig } from "@/lib/public-data";
import { notFound } from "next/navigation";
import { SignUp } from "@clerk/nextjs";

type Props = {
    params: Promise<{ domain: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function TenantSignUpPage(props: Props) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const config = await getSiteConfig(params.domain);
    const emailAddress = typeof searchParams.email_address === 'string' ? searchParams.email_address : undefined;

    if (!config) {
        notFound();
    }

    return (
        <div className="flex flex-col items-center justify-center py-20">
            <SignUp
                signInUrl="/sign-in"
                initialValues={{
                    emailAddress: emailAddress
                }}
                unsafeMetadata={{
                    locationId: config.location.id
                }}
            />
        </div>
    );
}

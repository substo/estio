import Link from "next/link";
import { Button } from "../ui/button";
import ModeToggle from "../mode-toggle";

export default function HeroSection() {
    return (
        <section className='flex flex-col items-center justify-center min-h-[60vh] leading-6 mt-[3rem]' aria-label="Estio Hero">
            <h1 className={`text-2xl sm:text-2xl md:text-3xl lg:text-5xl scroll-m-20 font-semibold tracking-tight text-center max-w-[1120px] bg-gradient-to-b dark:text-white`}>
                Your AI-Powered Real Estate Engine, Built for GoHighLevel
            </h1>
            <p className="text-sm mx-auto max-w-[700px] text-gray-500 text-center mt-2 dark:text-gray-400">
                Vision-powered imports, intelligent feed mapping, and instant site generation. Sync listings, capture leads, and manage contacts—seamlessly integrated.
            </p>
            <div className="flex justify-center items-center mt-5 gap-3">
                <Link href="/admin">
                    <Button className="animate-buttonheartbeat rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white">
                        Get Started
                    </Button>
                </Link>
                <Link href="/setup">
                    <Button variant="outline" className="rounded-md text-sm font-semibold">
                        Agency Installation
                    </Button>
                </Link>
                <ModeToggle />
            </div>
            {/* <div>
                <div className="relative flex max-w-6xl justify-center overflow-hidden mt-7">
                    <div className="relative rounded-xl">
                        <Image
                            src="https://utfs.io/f/31dba2ff-6c3b-4927-99cd-b928eaa54d5f-5w20ij.png"
                            alt="Nextjs Starter Kit Dashboard Preview"
                            width={1100}
                            height={550}
                            priority={true}
                            className="block rounded-[inherit] border object-contain shadow-lg dark:hidden"
                        />
                        <Image
                            src="https://utfs.io/f/69a12ab1-4d57-4913-90f9-38c6aca6c373-1txg2.png"
                            width={1100}
                            height={550}
                            alt="Nextjs Starter Kit Dark Mode Dashboard Preview"
                            priority={true}
                            className="dark:block rounded-[inherit] border object-contain shadow-lg hidden"
                        />
                        <BorderBeam size={250} duration={12} delay={9} />
                    </div>
                </div>
            </div> */}
        </section>
    )
}

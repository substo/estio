import { Montserrat, Inter } from "next/font/google";

const heading = Montserrat({ subsets: ["latin"], variable: "--font-heading", weight: ["300", "400", "500", "600", "700", "800"] });
const body = Inter({ subsets: ["latin"], variable: "--font-sans", weight: ["300", "400", "500", "600"] });
export const websiteBodyClassName = `${body.variable} ${heading.variable} font-sans min-h-screen flex flex-col`;

import { APP_URL } from "@/lib/app-config";

type SitemapEntry = {
  url: string;
  lastModified: string;
  changeFrequency:
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";
  priority?: number;
};

export default async function sitemap(): Promise<SitemapEntry[]> {
  const baseUrl = APP_URL;

  const staticPages: SitemapEntry[] = [
    {
      url: baseUrl,
      lastModified: new Date().toISOString(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${baseUrl}/privacy-policy`,
      lastModified: new Date().toISOString(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/terms-of-service`,
      lastModified: new Date().toISOString(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];

  return [...staticPages];
}

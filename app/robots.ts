import { MetadataRoute } from 'next'

import { APP_URL } from "@/lib/app-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/admin/',
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  }
}
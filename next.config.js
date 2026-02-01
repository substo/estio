/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add logging to see if config loads
  onDemandEntries: {
    // Make sure entries are not disposed too quickly
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
  transpilePackages: ['@tiptap/extension-history', '@tiptap/pm'],
  serverExternalPackages: ['bullmq', 'puppeteer'],


  images: {
    remotePatterns: [{
      protocol: 'https',
      hostname: 'images.unsplash.com',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'seo-heist.s3.amazonaws.com',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'github.com',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'ansubkhan.com',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'utfs.io',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'imagedelivery.net',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'placehold.co',
      port: '',
    }, {
      protocol: 'https',
      hostname: 'ajamigroup.notion.site',
      port: '',
      pathname: '/**'
    }, {
      protocol: 'https',
      hostname: 'www.downtowncyprus.com',
      port: '',
      pathname: '/**'
    }],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  experimental: {
    // serverActions is enabled by default in Next.js 15.
    // bodySizeLimit currently removed to test stability. Default is 1MB.
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [

          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com;",
          },
        ],
      },
    ];
  },

  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tiptap/pm/history': 'prosemirror-history',
      '@tiptap/pm/state': 'prosemirror-state',
      '@tiptap/pm/view': 'prosemirror-view',
      '@tiptap/pm/model': 'prosemirror-model',
      '@tiptap/pm/transform': 'prosemirror-transform',
      '@tiptap/pm/commands': 'prosemirror-commands',
      '@tiptap/pm/schema-list': 'prosemirror-schema-list',
      '@tiptap/pm/dropcursor': 'prosemirror-dropcursor',
      '@tiptap/pm/gapcursor': 'prosemirror-gapcursor',
      '@tiptap/pm/keymap': 'prosemirror-keymap',
      '@tiptap/pm/inputrules': 'prosemirror-inputrules',
    };
    return config;
  },
};
module.exports = nextConfig;
import { Button } from '@/components/ui/button';
import { Metadata } from 'next';
import Link from 'next/link';
import PageWrapper from "@/components/wrapper/page-wrapper";
import { Sparkles, Wand2, PenTool, Database } from "lucide-react";

export const metadata: Metadata = {
  title: 'Estio - Features',
  description: 'Explore the AI-powered features of Estio, from vision-based import to generative site building.',
};

export default function MarketingPage() {
  return (
    <PageWrapper>
      <div className="flex flex-col min-h-screen items-center mt-[2.5rem] p-3 w-full">

        {/* Hero */}
        <div className="flex flex-col items-center text-center space-y-4 mb-16">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/80 uppercase">
            Release v2.0
          </div>
          <h1 className="scroll-m-20 text-4xl lg:text-6xl font-extrabold tracking-tight">
            Features that feel like <span className="text-secondary-foreground text-blue-600">Magic</span>
          </h1>
          <p className="mx-auto max-w-[700px] text-gray-500 text-lg md:text-xl dark:text-gray-400">
            Automate your entire real estate workflow with the power of generative AI.
            From import to publish, we handle the heavy lifting.
          </p>
          <div className='flex flex-row gap-4 mt-6'>
            <Link href="/admin">
              <Button size="lg">Get Started</Button>
            </Link>
          </div>
        </div>

        {/* Feature 1: The Brain */}
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-24">
          <div className="flex flex-col space-y-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/40 w-fit rounded-xl text-blue-600 dark:text-blue-400">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold tracking-tighter">The Brain: Magic Import</h2>
            <p className="text-gray-500 dark:text-gray-400 text-lg leading-relaxed">
              We don't just scrape text. Our <strong className="text-foreground">Vision AI</strong> "sees" the property like a human would.
              Paste any URL or upload a screenshot, and our engine extracts prices, specs, amenities, and even detects the condition of the property.
            </p>
            <ul className="space-y-2 mt-2">
              <li className="flex items-center gap-2">
                <span className="text-green-500">✓</span> Extracts 50+ data points
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-500">✓</span> Auto-detects room counts from photos
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-500">✓</span> Standardizes messy data automatically
              </li>
            </ul>
          </div>
          <div className="relative h-[300px] md:h-[400px] w-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 rounded-xl border flex items-center justify-center overflow-hidden">
            {/* Abstract UI representation */}
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30">
              <div className="w-3/4 h-1/2 bg-background rounded shadow-xl border p-4 space-y-2">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 w-1/3 rounded"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 w-1/2 rounded"></div>
                <div className="h-24 bg-slate-100 dark:bg-slate-800 w-full rounded border border-dashed border-slate-300"></div>
              </div>
            </div>
            <p className="font-mono text-sm text-muted-foreground z-10">Processing Image Data...</p>
          </div>
        </div>

        {/* Feature 2: The Designer */}
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-24 md:flex-row-reverse">
          <div className="order-2 md:order-1 relative h-[300px] md:h-[400px] w-full bg-slate-50 dark:bg-slate-900 rounded-xl border flex items-center justify-center p-8">
            <div className="grid grid-cols-2 gap-4 w-full h-full opacity-50">
              <div className="bg-background rounded-lg shadow-sm border p-4"></div>
              <div className="bg-background rounded-lg shadow-sm border p-4"></div>
              <div className="col-span-2 bg-background rounded-lg shadow-sm border p-4"></div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center font-mono text-sm text-yellow-600 bg-yellow-100/10 backdrop-blur-[1px]">
              Generating Layout...
            </div>
          </div>
          <div className="flex flex-col space-y-4 order-1 md:order-2">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/40 w-fit rounded-xl text-purple-600 dark:text-purple-400">
              <Wand2 className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold tracking-tighter">The Designer: Generative Site Builder</h2>
            <p className="text-gray-500 dark:text-gray-400 text-lg leading-relaxed">
              Turn a simple database entry into a luxury landing page in one click.
              Our <strong className="text-foreground">Design Engine</strong> selects the perfect components,
              applies your brand colors, and writes compelling copy to match.
            </p>
            <ul className="space-y-2 mt-2">
              <li className="flex items-center gap-2">
                <span className="text-green-500">✓</span> Mobile-responsive by default
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-500">✓</span> SEO-optimized meta tags
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-500">✓</span> Interactive maps & galleries
              </li>
            </ul>
          </div>
        </div>

        {/* Feature 3: The Marketer */}
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-24">
          <div className="flex flex-col space-y-4">
            <div className="p-3 bg-pink-100 dark:bg-pink-900/40 w-fit rounded-xl text-pink-600 dark:text-pink-400">
              <PenTool className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold tracking-tighter">The Marketer: Brand Voice Cloning</h2>
            <p className="text-gray-500 dark:text-gray-400 text-lg leading-relaxed">
              Never write another description again. Our AI analyzes your previous successful listings and website to learn your unique <strong className="text-foreground">Brand Voice</strong>.
              It then generates descriptions that sound exactly like you wrote them.
            </p>
          </div>
          <div className="relative h-[250px] w-full bg-slate-50 dark:bg-slate-900 rounded-xl border flex flex-col p-6 space-y-4 shadow-inner">
            <div className="flex space-x-2">
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700"></div>
              <div className="space-y-1">
                <div className="h-2 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
                <div className="h-2 w-16 bg-slate-100 dark:bg-slate-800 rounded"></div>
              </div>
            </div>
            <div className="flex-1 bg-background rounded p-4 text-xs text-muted-foreground font-mono leading-relaxed border">
              "Experience the pinnacle of coastal living in this stunning 3-bedroom villa..."
              <span className="animate-pulse inline-block w-1.5 h-3 bg-primary ml-1 align-middle"></span>
            </div>
          </div>
        </div>

        {/* Feature 4: Integration */}
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-16 md:flex-row-reverse">

          <div className="order-2 md:order-1 relative h-[300px] w-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow-2xl flex items-center justify-center transform hover:scale-[1.02] transition-transform">
            <div className="text-white font-bold text-2xl tracking-widest">GOHIGHLEVEL</div>
          </div>

          <div className="flex flex-col space-y-4 order-1 md:order-2">
            <div className="p-3 bg-green-100 dark:bg-green-900/40 w-fit rounded-xl text-green-600 dark:text-green-400">
              <Database className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold tracking-tighter">The Integrator: Native GHL Sync</h2>
            <p className="text-gray-500 dark:text-gray-400 text-lg leading-relaxed">
              The only platform that treats GoHighLevel as a first-class citizen.
              Every lead captured, every contact made, and every viewing requested is instantly synced to your GHL CRM sub-account.
            </p>
            <div className="flex gap-4 pt-4">
              <Link href="/setup">
                <Button variant="outline">View Integration Guide</Button>
              </Link>
            </div>
          </div>
        </div>

      </div>
    </PageWrapper>
  )
}

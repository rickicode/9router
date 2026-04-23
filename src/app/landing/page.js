"use client";

import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroSection from "./components/HeroSection";
import FlowAnimation from "./components/FlowAnimation";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="relative text-[var(--color-text-main)] font-sans overflow-x-hidden antialiased selection:bg-[var(--color-primary)]">
      {/* Clean Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-[var(--color-bg-alt)]">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/3 via-transparent to-transparent" />
      </div>

      <div className="relative z-10">
        <Navigation />
        
        <main>
          {/* Hero with Flow Animation */}
          <div className="relative">
            <HeroSection />
            <div className="flex justify-center pb-20">
              <FlowAnimation />
            </div>
          </div>
        
          <GetStarted />
          <HowItWorks />
          <Features />
        
          {/* CTA Section */}
          <section className="py-24 px-6 bg-[var(--color-bg-alt)]-alt relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />
            <div className="max-w-4xl mx-auto text-center relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-[var(--color-text-main)]">Ready to Simplify Your AI Infrastructure?</h2>
              <p className="text-lg text-[var(--color-text-muted)] mb-8 max-w-2xl mx-auto">
                Join developers who are streamlining their AI integrations with 9Router. Open source and free to start.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button 
                  onClick={() => router.push("/dashboard")}
                  className="w-full sm:w-auto h-12 px-8 rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary)]-hover text-white text-base font-semibold transition-all  bg-[rgba(0,122,255,0.25)] active:scale-[0.99]"
                >
                  Start Free
                </button>
                <button 
                  onClick={() => window.open("https://github.com/decolua/9router#readme", "_blank")}
                  className="w-full sm:w-auto h-12 px-8 rounded border border-[rgba(15,0,0,0.12)] bg-[var(--color-surface)] hover:bg-[var(--color-bg-alt)]-alt text-[var(--color-text-main)] text-base font-semibold transition-all"
                >
                  Read Documentation
                </button>
              </div>
            </div>
          </section>
        </main>
        
        <Footer />
      </div>
    </div>
  );
}


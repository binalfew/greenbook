import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Globe, Shield, Users, Zap } from "lucide-react";
import { LanguageSwitcher } from "~/components/language-switcher";
import type { SupportedLanguage } from "~/utils/i18n";

// Rotating quotes — edit freely, the component picks a new one every 6s.
const TESTIMONIALS = [
  {
    quote:
      "Streamlined our operations across 12 offices. The multi-tenant architecture is exactly what we needed.",
    initials: "JD",
    name: "Jane Doe",
    role: "CTO, Acme Corp",
  },
  {
    quote:
      "Cut our onboarding time by 60%. The role-based access and team management are incredibly intuitive.",
    initials: "MK",
    name: "Michael Kim",
    role: "VP Engineering, Globex",
  },
  {
    quote:
      "The best admin platform we've used. 2FA, audit logs, and multi-language support out of the box.",
    initials: "SL",
    name: "Sarah Lee",
    role: "CISO, Initech",
  },
];

// Counts up to `target` when the element scrolls into view. Runs once.
function useCountUp(target: number, duration = 1500) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const counted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !counted.current) {
          counted.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.round(eased * target));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);

  return { value, ref };
}

function useParallax() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    setOffset({ x, y });
  }, []);

  const handleMouseLeave = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return { offset, panelRef, handleMouseMove, handleMouseLeave };
}

function StarIcon() {
  return (
    <svg className="size-5 fill-amber-400" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

/**
 * Branded left panel — only visible on large screens. Rotates testimonials,
 * animates stats on scroll-in, and tracks the cursor for a subtle parallax
 * effect. Pure marketing surface; no props — fork the file to rebrand.
 */
export function BrandedPanel() {
  const [testimonialIdx, setTestimonialIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTestimonialIdx((i) => (i + 1) % TESTIMONIALS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);
  const testimonial = TESTIMONIALS[testimonialIdx];

  const stat1 = useCountUp(10000);
  const stat2 = useCountUp(999);
  const stat3 = useCountUp(50);

  const { offset, panelRef, handleMouseMove, handleMouseLeave } = useParallax();

  return (
    <div
      ref={panelRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="from-primary via-primary/90 to-primary/80 dark:from-primary/80 dark:via-primary/70 dark:to-primary/60 relative hidden overflow-hidden bg-gradient-to-br lg:flex lg:w-1/2"
    >
      {/* Dotted grid backdrop */}
      <div className="absolute inset-0 opacity-[0.07]">
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="currentColor" className="text-primary-foreground" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Parallax floating blobs */}
      <div
        className="bg-primary-foreground/[0.06] absolute top-20 left-16 size-72 animate-[float_20s_ease-in-out_infinite] rounded-full blur-3xl transition-transform duration-700 ease-out"
        style={{ transform: `translate(${offset.x * 20}px, ${offset.y * 20}px)` }}
      />
      <div
        className="bg-primary-foreground/[0.06] absolute right-12 bottom-24 size-56 animate-[float_25s_ease-in-out_infinite_2s] rounded-full blur-3xl transition-transform duration-700 ease-out"
        style={{ transform: `translate(${offset.x * -15}px, ${offset.y * -15}px)` }}
      />
      <div
        className="bg-primary-foreground/[0.04] absolute top-1/3 right-1/3 size-40 animate-[float_18s_ease-in-out_infinite_4s] rounded-full blur-2xl transition-transform duration-700 ease-out"
        style={{ transform: `translate(${offset.x * 10}px, ${offset.y * -10}px)` }}
      />

      {/* Decorative rings */}
      <div className="border-primary-foreground/[0.08] absolute -bottom-32 -left-32 size-96 rounded-full border" />
      <div className="border-primary-foreground/[0.06] absolute -top-24 -right-24 size-72 rounded-full border" />

      <div className="text-primary-foreground relative z-10 flex flex-col justify-between p-12">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="bg-primary-foreground/15 flex size-11 items-center justify-center rounded-xl shadow-lg shadow-black/10 backdrop-blur-sm">
            <Shield className="size-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight">Admin Platform</span>
            <p className="text-primary-foreground/50 text-[11px] tracking-widest uppercase">
              Enterprise Suite
            </p>
          </div>
        </div>

        {/* Rotating testimonial */}
        <div className="max-w-lg space-y-10">
          <div key={testimonialIdx} className="animate-[testimonialIn_0.6s_ease-out] space-y-6">
            <div className="flex gap-1">
              {[...Array(5)].map((_, i) => (
                <StarIcon key={i} />
              ))}
            </div>
            <blockquote className="space-y-4">
              <p className="text-[1.7rem] leading-snug font-semibold tracking-tight">
                &ldquo;{testimonial.quote}&rdquo;
              </p>
              <footer className="flex items-center gap-3">
                <div className="bg-primary-foreground/15 flex size-10 items-center justify-center rounded-full text-sm font-bold">
                  {testimonial.initials}
                </div>
                <div>
                  <p className="text-sm font-medium">{testimonial.name}</p>
                  <p className="text-primary-foreground/60 text-xs">{testimonial.role}</p>
                </div>
              </footer>
            </blockquote>

            <div className="flex gap-2">
              {TESTIMONIALS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setTestimonialIdx(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === testimonialIdx
                      ? "bg-primary-foreground/70 w-6"
                      : "bg-primary-foreground/25 hover:bg-primary-foreground/40 w-1.5"
                  }`}
                  aria-label={`Testimonial ${i + 1}`}
                />
              ))}
            </div>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-3">
            {[
              { icon: Shield, label: "Enterprise Security" },
              { icon: Zap, label: "Real-time Sync" },
              { icon: Globe, label: "Multi-language" },
              { icon: Users, label: "Team Management" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="bg-primary-foreground/10 hover:bg-primary-foreground/15 flex items-center gap-2 rounded-full px-4 py-2 text-sm backdrop-blur-sm transition-colors"
              >
                <Icon className="size-3.5" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom stats + footer */}
        <div className="space-y-6">
          <div className="flex gap-8">
            <div ref={stat1.ref}>
              <p className="animate-[countUp_0.8s_ease-out] text-2xl font-bold">
                {stat1.value.toLocaleString()}+
              </p>
              <p className="text-primary-foreground/50 text-xs">Active users</p>
            </div>
            <div className="bg-primary-foreground/10 h-10 w-px" />
            <div ref={stat2.ref}>
              <p className="animate-[countUp_0.8s_ease-out_0.2s_both] text-2xl font-bold">
                {(stat2.value / 10).toFixed(1)}%
              </p>
              <p className="text-primary-foreground/50 text-xs">Uptime</p>
            </div>
            <div className="bg-primary-foreground/10 h-10 w-px" />
            <div ref={stat3.ref}>
              <p className="animate-[countUp_0.8s_ease-out_0.4s_both] text-2xl font-bold">
                {stat3.value}+
              </p>
              <p className="text-primary-foreground/50 text-xs">Organizations</p>
            </div>
          </div>
          <p className="text-primary-foreground/30 text-xs">
            &copy; {new Date().getFullYear()} Admin Platform. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

export type RightPanelProps = {
  children: React.ReactNode;
  /** Current resolved language. When provided the top-bar renders a switcher. */
  currentLanguage?: SupportedLanguage;
  /** Optional allowlist of language codes (defaults to all supported). */
  allowedLanguages?: readonly string[];
};

/**
 * Right-side container for auth routes. Hosts the language switcher (top-bar),
 * a mobile-only logo, the route content, and trust-signal microcopy.
 */
export function RightPanel({ children, currentLanguage, allowedLanguages }: RightPanelProps) {
  return (
    <div className="bg-background flex w-full flex-col lg:w-1/2">
      <div className="flex justify-end p-4">
        {currentLanguage && (
          <LanguageSwitcher currentLanguage={currentLanguage} allowed={allowedLanguages} />
        )}
      </div>

      <div className="flex flex-1 flex-col justify-center px-6 pb-12 lg:px-16 xl:px-24">
        <div className="mb-10 flex items-center gap-3 lg:hidden">
          <div className="bg-primary text-primary-foreground shadow-primary/25 flex size-11 items-center justify-center rounded-xl shadow-lg">
            <Shield className="size-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight">Admin Platform</span>
            <p className="text-muted-foreground text-[11px] tracking-widest uppercase">
              Enterprise Suite
            </p>
          </div>
        </div>

        {children}

        <div className="mt-10 flex flex-col items-center gap-3">
          <div className="text-muted-foreground/50 flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs">
              <Shield className="size-3" />
              <span>SSL Secured</span>
            </div>
            <div className="bg-muted-foreground/20 size-1 rounded-full" />
            <div className="flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="size-3" />
              <span>SOC 2 Compliant</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Simple content wrapper applied to each auth route. Constrains width and
 * fades in on mount so route transitions feel intentional.
 */
export function AuthContent({
  children,
  maxWidth = "max-w-sm",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className={`mx-auto w-full ${maxWidth} animate-[fadeIn_0.5s_ease-out]`}>{children}</div>
  );
}

import Hero from '@/components/hero';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function HomePage() {
  return (
    <div className="bg-surface min-h-screen flex flex-col">
      <main className="w-full pt-20 bg-surface flex-grow">
        <Hero />
      </main>

      <footer className="w-full bg-surface-ivory pt-16 pb-12 shadow-[0_-1px_12px_rgba(0,0,0,0.02)]">
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 lg:gap-12 pb-12">
            <div className="md:col-span-5 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="SFS Shanthinagar Emblem"
                  className="h-10 w-auto object-contain rounded-full"
                  src="/images/emblem.png"
                />
                <span className="text-headline-sm text-primary">
                  St. Francis de Sales&apos; High School
                </span>
              </div>

              <p className="text-body-sm text-on-surface-variant max-w-md mb-6">
                North Lalaguda, Shanthinagar, Secunderabad - 500017, Telangana, India
              </p>

              <div className="flex flex-col gap-2.5 mb-6">
                <a
                  href="mailto:info@sfsshanthinagar.com"
                  className="inline-flex items-center gap-2.5 text-body-sm text-on-surface-variant hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-primary text-[18px]">mail</span>
                  info@sfsshanthinagar.com
                </a>
                <a
                  href="mailto:sfsalumnis@gmail.com"
                  className="inline-flex items-center gap-2.5 text-body-sm text-on-surface-variant hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-primary text-[18px]">mail</span>
                  sfsalumnis@gmail.com
                </a>
                <a
                  href="tel:+918012345678"
                  className="inline-flex items-center gap-2.5 text-body-sm text-on-surface-variant hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-primary text-[18px]">call</span>
                  +91 80 1234 5678
                </a>
                <a
                  href="tel:+917416368516"
                  className="inline-flex items-center gap-2.5 text-body-sm text-on-surface-variant hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-primary text-[18px]">call</span>
                  +91 7416 368 516
                </a>
              </div>

              <div className="flex items-center gap-3">
                {['public', 'chat', 'photo_camera', 'smart_display'].map((icon) => (
                  <a
                    key={icon}
                    className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-primary hover:bg-primary hover:text-on-primary transition-colors"
                    href="#"
                  >
                    <span className="material-symbols-outlined text-[18px]">{icon}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="md:col-span-7 flex flex-col justify-between">
              <div className="w-full h-56 rounded-xl overflow-hidden bg-surface-container relative shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
                <iframe
                  className="w-full h-full border-0 filter contrast-[1.02] opacity-90 hover:opacity-100 transition-opacity"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src="https://maps.google.com/maps?q=St.+Francis+de+Sales+High+School+Shanthinagar+Secunderabad&t=&z=15&ie=UTF8&iwloc=&output=embed"
                  title="SFS Shanthinagar Campus Location"
                />
              </div>
              <div className="flex items-center gap-2 mt-3 text-on-surface-variant">
                <span className="material-symbols-outlined text-jubilee-amber text-[18px]">
                  location_on
                </span>
                <span className="text-label-sm uppercase tracking-wider">
                  Campus Location • North Lalaguda, Secunderabad
                </span>
              </div>
            </div>
          </div>

          <div className="pt-8 mt-2">
            <p className="text-body-sm text-on-surface-variant text-center sm:text-left">
              Copyright © 2026 St. Francis de Sales&apos; High School. All Rights Reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

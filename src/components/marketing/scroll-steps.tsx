"use client";

import { useEffect, useRef, useState } from "react";
import Image from "@/components/ui/app-image";
import type { ReactNode } from "react";
import { Emphasis } from "@/lib/marketing/rich-text";
import {
  DEFAULT_LANDING,
  type HowItWorksContent,
  type HowItWorksStep,
} from "@/lib/marketing/landing-types";

// Source of truth: Figma "PropertyPro" → "Desktop - 1" (node 4:3055), the
// "How It Works?" band at y 2911–3528 of the 1440px artboard.
//
// All four states are drawn in the file: step 1 lives inside "Desktop - 1",
// and the rest sit beside it on the "Saas" canvas — step 2 (4:3542), step 3
// (4:3543) and the closing panel (4:3532). Each is the same 1069.847 x 478.506
// box, so scrolling swaps the mockup and which step is expanded, nothing else.
//
// From `lg` up the panel is a container: positions are percentages of it and
// lengths are `cqw`, so it stays true to the design at any width. Below `lg`
// it falls back to a stacked flow layout, where the copy has to stay readable
// rather than scale with the box.
//
// The layout's positions are logical (`start-*`, `ps-*`), so the Arabic page
// mirrors it — steps on the right, the mockup on the left. The mockups
// themselves are drawings of the English product and stay left to right.
const ASSETS = "/images/marketing/steps";

// ---------------------------------------------------------------------------
// Stepper — 4:3203..4:3209 (rail, discs, numerals) and 4:3199..4:3202 (copy)
// ---------------------------------------------------------------------------

function Stepper({
  steps,
  active,
}: {
  steps: HowItWorksStep[];
  active: number;
}) {
  return (
    <div className="relative">
      {/* Vector 26: the rail sits behind the discs and stops inside the first
          and last one rather than at their edges. */}
      <span className="absolute start-[17px] top-[14px] bottom-[14px] w-[1.92px] -translate-x-1/2 rounded-full bg-[#c5c2cf] rtl:translate-x-1/2 lg:start-[34.36px] lg:top-[22.08px] lg:bottom-[18.73px]" />

      <ol className="relative space-y-2 lg:space-y-[4.37px]">
        {steps.map((step, index) => {
          const selected = active === index;

          return (
            <li key={step.title || index}>
              <div className="flex items-center gap-3 lg:gap-[28.4px]">
                <span className="flex size-[34px] shrink-0 items-center justify-center lg:size-[6.423cqw]">
                  <span
                    className={`grid place-items-center rounded-full border-[#2f2158] transition-all duration-700 ease-out motion-reduce:transition-none ${
                      selected
                        ? "size-full border-[0.96px] bg-[#2b55ff] text-white lg:border-[0.090cqw]"
                        : "size-[69.5%] border-[0.67px] bg-[#f3f3f3] text-[#2f2158] lg:border-[0.062cqw]"
                    }`}
                  >
                    <span
                      className={
                        selected
                          ? "text-[17px] leading-[1.2] lg:text-[3.224cqw]"
                          : "text-[12px] leading-[1.2] lg:text-[2.239cqw]"
                      }
                    >
                      {index + 1}
                    </span>
                  </span>
                </span>

                <h3
                  className={`transition-all duration-700 ease-out motion-reduce:transition-none ${
                    selected
                      ? "text-[17px] font-bold leading-[1.2] tracking-[0.34px] text-[#2f2158] lg:text-[2.866cqw] lg:tracking-[0.057cqw]"
                      : "text-[14px] font-bold leading-[1.2] tracking-[0.28px] text-[rgba(47,33,88,0.31)] lg:text-[2.149cqw] lg:tracking-[0.043cqw]"
                  }`}
                >
                  {step.title}
                </h3>
              </div>

              <div
                className={`grid transition-all duration-700 ease-out motion-reduce:transition-none ${
                  selected
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="max-w-[389px] ps-[46px] pt-3 pb-4 text-[13px] leading-[1.38] tracking-[0.26px] text-[#323232] lg:max-w-[36.385cqw] lg:ps-[97.11px] lg:pt-[28.08px] lg:pb-[71.55px] lg:text-[1.791cqw] lg:tracking-[0.036cqw]">
                    {step.description}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signup card — 4:3210 (header bar), 4:3212 (form), 4:3213/4:3214 (button)
// ---------------------------------------------------------------------------

/** The blue bar + card the mockups sit in — identical across the three states
 *  (4:3210/4:3212, 4:3567/4:3568, 4:3598/4:3599). Its own `@container` so the
 *  chrome's type tracks the card rather than the panel. */
function MockupFrame({
  cardBg,
  brandName,
  children,
}: {
  cardBg: string;
  brandName: string;
  children: ReactNode;
}) {
  return (
    <div className="@container relative aspect-[357.68/391.78] w-full" dir="ltr" lang="en">
      <div className="absolute inset-x-0 top-0 h-[23.80%] rounded-[5.893cqw] bg-[#2b55ff]" />
      <Image
        src={`${ASSETS}/brand-mark.svg`}
        alt=""
        width={15}
        height={18}
        unoptimized
        className="absolute left-[9.03%] top-[2.81%] h-[4.49%] w-[4.03%]"
      />
      <span className="absolute left-[16.25%] top-[2.95%] text-[3.635cqw] font-bold leading-[1.2] text-white">
        {brandName}
      </span>
      <div
        className="absolute inset-x-0 top-[8.70%] h-[91.30%] overflow-hidden rounded-[5.893cqw] border-[0.268cqw] border-[#d4d4d4] shadow-[0_2.411cqw_3.911cqw_rgba(22,0,222,0.13)]"
        style={{ backgroundColor: cardBg }}
      >
        {children}
      </div>
    </div>
  );
}

/** Step 1 — 4:3212. Full-bleed export; the design redraws the primary button
 *  on top of it in brand blue, since the export itself reads "Submit Request". */
function SignupMockup() {
  return (
    <>
      <Image
        src={`${ASSETS}/signup-form.png`}
        alt="PropertyPro signup form"
        fill
        sizes="(max-width: 1024px) 90vw, 358px"
        className="object-cover"
      />
      <span className="absolute left-[52.32%] top-[87.53%] grid h-[9.71%] w-[44.01%] place-items-center rounded-[2.679cqw] bg-[#2b55ff] text-[4.018cqw] font-bold leading-none text-white">
        Get Started
      </span>
    </>
  );
}

/** Step 2 — 4:3568. Inset export rather than full-bleed. */
function PropertyMockup() {
  return (
    <Image
      src={`${ASSETS}/add-property.png`}
      alt="Add your first property, with an optional first tenant"
      width={414}
      height={457}
      sizes="(max-width: 1024px) 90vw, 358px"
      className="absolute left-[6.32%] top-[2.62%] h-[94.77%] w-[87.36%] max-w-none"
    />
  );
}

/** Step 3 — 4:3599. */
function AutomationMockup() {
  return (
    <Image
      src={`${ASSETS}/automations.png`}
      alt="Automation overview with rent reminders, invoices, late fees and ticket routing"
      width={464}
      height={473}
      sizes="(max-width: 1024px) 90vw, 358px"
      className="absolute left-[5.5%] top-[3.43%] h-[92.61%] w-[90.84%] max-w-none"
    />
  );
}

// Each state pairs its export with the card fill the design sits it on.
const mockups = [
  { bg: "#ffffff", node: <SignupMockup /> },
  { bg: "#fbfcfe", node: <PropertyMockup /> },
  { bg: "#fdfdfe", node: <AutomationMockup /> },
];

/** Closing state — 4:3532 (panel), 4:3535 (mark), 4:3533/4:3534 (copy). */
function FinalState({
  heading,
  body,
}: {
  heading: string;
  body: string;
}) {
  return (
    <>
      <Image
        src="/images/marketing/features/logo-mark.svg"
        alt=""
        width={124}
        height={151}
        unoptimized
        className="absolute start-[12.99%] top-[25.47%] hidden h-[31.52%] w-[11.59%] lg:block"
      />
      <div className="px-8 text-white sm:px-12 lg:absolute lg:start-[37.48%] lg:top-[23.59%] lg:w-[57.66%] lg:px-0">
        {/* Light by default; the console's `**bold**` runs carry the accents,
            and a `\n` in the field is the designed line break. */}
        <h3 className="text-3xl font-light leading-[1.2] tracking-[0.64px] sm:text-4xl lg:whitespace-nowrap lg:text-[4.876cqw] lg:tracking-[0.098cqw]">
          <Emphasis text={heading} />
        </h3>
        <p className="mt-5 text-sm leading-normal tracking-[0.28px] sm:text-base lg:mt-[7.36cqw] lg:text-[1.950cqw] lg:tracking-[0.039cqw]">
          <Emphasis text={body} />
        </p>
      </div>
    </>
  );
}

export function ScrollSteps({
  content,
  brandName,
}: {
  content: HowItWorksContent;
  brandName: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);

  // Each step is paired with its built-in mockup by position, and the scroll
  // stages below are cut for exactly three of them. A stored array of any other
  // length — only reachable by editing the document outside the console — would
  // leave steps with no copy or no artwork, so fall back to the shipped three
  // rather than render blanks. Same positional guard the product tabs use.
  const stored =
    content.steps?.length === mockups.length
      ? content.steps
      : DEFAULT_LANDING.howItWorks.steps;
  const steps = mockups.map((mockup, index) => ({
    title: stored[index].title,
    description: stored[index].description,
    image: stored[index].image?.trim() || "",
    bg: mockup.bg,
    node: mockup.node,
  }));

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const distance = Math.max(section.offsetHeight - window.innerHeight, 1);
      const progress = Math.min(
        1,
        Math.max(0, -section.getBoundingClientRect().top / distance),
      );
      setStage(progress < 0.23 ? 0 : progress < 0.48 ? 1 : progress < 0.73 ? 2 : 3);
    };
    const requestUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const final = stage === 3;

  // The sticky child is a full viewport tall and centres its content, so it
  // leaves (100svh - 681)/2 + 32px of dead space under the panel before the
  // section ends — space that grows with the window. `mb` cancels exactly that
  // in the flow (the pinned rendering is untouched) so the next section owns
  // the gap, the way every other boundary here works.
  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative h-[440svh] lg:mb-[calc(308.5px-50svh)]"
    >
      <div className="sticky top-0 h-svh overflow-hidden bg-white">
        <div className="flex h-full flex-col justify-center px-4 py-5 sm:px-8 sm:py-8">
          <div className="text-center">
            <p className="text-[13px] font-semibold leading-[1.2] tracking-[0.78px] text-[#0059ff] sm:text-[16px] sm:tracking-[0.96px]">
              {content.eyebrow}
            </p>
            <h2 className="mt-[8.95px] text-[32px] font-bold leading-[1.2] tracking-[0.64px] text-[#2f2158] sm:text-[48px] sm:tracking-[0.96px]">
              {content.heading}
            </h2>
          </div>

          <div className="relative mx-auto mt-[52.42px] w-full max-w-[1069.847px]">
            <div
              className={`@container relative overflow-hidden rounded-[24px] bg-gradient-to-b from-[#f9f2ff] to-[#f3f3f3] px-6 py-8 transition-all duration-700 ease-out motion-reduce:transition-none lg:aspect-[1069.847/478.506] lg:rounded-[34.493px] lg:px-0 lg:py-0 ${
                final
                  ? "pointer-events-none -translate-y-4 scale-[.98] opacity-0"
                  : "translate-y-0 scale-100 opacity-100"
              }`}
            >
              <div className="lg:absolute lg:start-[3.928%] lg:top-[9.364%] lg:w-[49.4%]">
                <Stepper steps={steps} active={Math.min(stage, 2)} />
              </div>

              <div className="relative mx-auto mt-8 w-full max-w-[357.68px] lg:absolute lg:start-[60.589%] lg:top-[7.325%] lg:mt-0 lg:h-[81.87%] lg:w-[33.433%] lg:max-w-none">
                {steps.map((step, index) => (
                  <div
                    key={index}
                    className={`transition-all duration-700 ease-out motion-reduce:transition-none lg:absolute lg:inset-0 ${
                      stage === index
                        ? "z-10 translate-x-0 scale-100 opacity-100"
                        : "pointer-events-none absolute inset-0 z-0 translate-x-5 scale-[.97] opacity-0 rtl:-translate-x-5"
                    }`}
                  >
                    <MockupFrame cardBg={step.image ? "#ffffff" : step.bg} brandName={brandName}>
                      {step.image ? (
                        // A console upload replaces the built-in mockup inside
                        // the branded frame, the way the product tabs work.
                        <Image
                          src={step.image}
                          alt={step.title}
                          fill
                          sizes="(max-width: 1024px) 90vw, 358px"
                          className="object-cover object-top"
                        />
                      ) : (
                        step.node
                      )}
                    </MockupFrame>
                  </div>
                ))}
              </div>
            </div>

            <div
              className={`@container absolute inset-0 flex items-center overflow-hidden rounded-[24px] bg-[#2b55ff] transition-all duration-700 ease-out motion-reduce:transition-none lg:rounded-[34.493px] ${
                final
                  ? "translate-y-0 scale-100 opacity-100"
                  : "pointer-events-none translate-y-4 scale-[.98] opacity-0"
              }`}
            >
              <FinalState
                heading={content.finalHeading}
                body={content.finalBody}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

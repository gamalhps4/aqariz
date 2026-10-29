import Image from "@/components/ui/app-image";
import { Building2 } from "lucide-react";

// Brand lockup for the marketing/public chrome. When the platform admin has
// uploaded a logo (Platform Console → Settings → General & branding), it renders
// that image; otherwise it falls back to the icon + platform name. `inverse`
// styles the fallback for dark surfaces.
//
// `shrink` is for a bar it shares with buttons (the phone header): there it
// gives way rather than wrap its name onto two lines or push the buttons out.
// The name wraps onto a second line that is clipped, so it shows exactly when
// it fits beside the mark, whatever its length; an uploaded logo scales down.
// Its parent must let it shrink (a flex container with a min width).
export function Brand({
  inverse = false,
  name = "PropertyPro",
  logoUrl,
  shrink = false,
}: {
  inverse?: boolean;
  name?: string;
  logoUrl?: string;
  shrink?: boolean;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={name}
        width={160}
        height={40}
        className={`h-8 w-auto object-contain ${shrink ? "min-w-0" : ""}`}
        priority
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2.5 ${shrink ? "h-8 min-w-0 flex-wrap overflow-hidden" : ""}`}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-lg ${inverse ? "bg-white text-blue-600" : "bg-blue-600 text-white"}`}
      >
        <Building2 className="size-4.5" />
      </span>
      <span
        className={`text-[15px] font-bold tracking-[-0.02em] ${shrink ? "whitespace-nowrap" : ""} ${inverse ? "text-white" : "text-slate-950"}`}
      >
        {name}
      </span>
    </span>
  );
}

import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const alt = "EndzoneIQ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default share image for every page without its own (static, no data). */
export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 32,
        background: "#0b0f17",
        color: "#eef2f7",
        padding: 80,
      }}
    >
      <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>
        Endzone<span style={{ color: "#34d399" }}>IQ</span>
      </div>
      <div style={{ display: "flex", fontSize: 52, fontWeight: 700, maxWidth: 1000 }}>
        {t("tagline")}
      </div>
      <div style={{ display: "flex", fontSize: 30, color: "#9aa6b8", maxWidth: 1000 }}>
        {t("intro")}
      </div>
    </div>,
    size,
  );
}

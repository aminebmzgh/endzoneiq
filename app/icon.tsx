import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

/** App and notification icon: the "IQ" mark, no NFL or team imagery. */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0f17",
        color: "#34d399",
        fontSize: 104,
        fontWeight: 800,
        borderRadius: 36,
      }}
    >
      IQ
    </div>,
    size,
  );
}

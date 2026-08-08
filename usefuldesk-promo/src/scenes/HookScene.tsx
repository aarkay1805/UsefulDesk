import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import {Brand, Eyebrow, SceneBackground} from "../components";

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: "#0d0d14", overflow: "hidden"}}>
      <SceneBackground />
      <Interactive.Div
        name="Opening content"
        style={{
          position: "absolute",
          inset: "78px 80px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          opacity: interpolate(frame, [0, 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Brand compact />
        <div style={{display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 32}}>
          <Eyebrow name="Category">India-first gym CRM</Eyebrow>
          <Interactive.Div
            name="Opening headline"
            style={{
              color: "#ffffff",
              fontSize: 92,
              lineHeight: 0.98,
              fontWeight: 780,
              letterSpacing: "-0.065em",
              maxWidth: 900,
              translate: interpolate(frame, [4, 24], ["0px 54px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            Every renewal.
            <br />
            One clear next action.
          </Interactive.Div>
          <Interactive.Div
            name="Opening subtitle"
            style={{
              color: "#aaa6b6",
              fontSize: 34,
              lineHeight: 1.35,
              fontWeight: 510,
              letterSpacing: "-0.025em",
              maxWidth: 790,
              opacity: interpolate(frame, [20, 38], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            Know who’s expiring. Remind on WhatsApp. Collect on UPI.
          </Interactive.Div>
        </div>
        <div style={{display: "flex", gap: 14, width: "100%"}}>
          {[
            ["17", "expiring"],
            ["₹64.5k", "due"],
            ["8", "follow-ups"],
          ].map(([value, label], index) => (
            <Interactive.Div
              name={`${label} signal`}
              key={label}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "20px 22px",
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,0.10)",
                backgroundColor: "rgba(255,255,255,0.045)",
                color: "#ffffff",
                opacity: interpolate(frame, [36 + index * 6, 52 + index * 6], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                translate: interpolate(frame, [36 + index * 6, 52 + index * 6], ["0px 24px", "0px 0px"], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              <span style={{fontSize: 34, fontWeight: 780, letterSpacing: "-0.04em"}}>{value}</span>
              <span style={{fontSize: 20, color: "#918d9d", fontWeight: 560}}>{label}</span>
            </Interactive.Div>
          ))}
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
